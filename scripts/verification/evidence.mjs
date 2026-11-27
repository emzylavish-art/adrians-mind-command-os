const sha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const link = (value) => {
  if (typeof value !== "string" || /\s/.test(value)) return false;
  if (value.startsWith("https://")) { try { return Boolean(new URL(value).hostname); } catch { return false; } }
  return /^(?:artifacts|docs|src|scripts)\//.test(value) && !value.split(/[\\/]/).includes("..");
};
const dated = (value, now) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(now) + 300000;
const statuses = new Set(["verified", "implemented with limitations", "blocked", "deferred"]);
const verificationStates = new Set(["passed", "failed", "skipped", "canceled", "unverified"]);
export const EVIDENCE_ENVIRONMENTS = Object.freeze(["source", "unit-fixture", "local-browser-chromium", "authenticated-preview", "authenticated-production", "physical-ios", "physical-windows", "physical-android"]);
const evidenceLinks = (value) => Array.isArray(value) && value.length > 0 && value.every(link);

/** Checks consistency of supplied evidence. It does not authenticate URLs, execute checks or contact a deployment. */
export function validateFeatureEvidence(document, { revision, now = new Date().toISOString(), requireCurrent = false } = {}) {
  const errors = []; const records = [];
  if (document?.schemaVersion !== 1) errors.push("Feature evidence schemaVersion must be 1.");
  if (!sha(revision)) errors.push("An exact candidate revision is required.");
  if (!Array.isArray(document?.features) || !document.features.length) errors.push("At least one feature record is required.");
  const ids = new Set();
  for (const item of document?.features || []) {
    const prefix = item.id || "unknown feature";
    if (!text(item.id) || ids.has(item.id)) errors.push(`${prefix}: missing or duplicate feature ID.`);
    ids.add(item.id);
    if (!text(item.title) || !statuses.has(item.status)) errors.push(`${prefix}: explicit title and completion status are required.`);
    const v = item.verification || {};
    if (!verificationStates.has(v.state) || !Array.isArray(v.blockers)) errors.push(`${prefix}: verification state and blockers are required.`);
    if (item.status === "verified" && v.state !== "passed") errors.push(`${prefix}: a verified completion claim needs passed evidence.`);
    if (v.state === "passed") {
      if (!sha(v.revision) || !EVIDENCE_ENVIRONMENTS.includes(v.environment) || !dated(v.executedAt, now) || !evidenceLinks(v.evidence)) errors.push(`${prefix}: passed evidence needs exact revision, environment, date and evidence links.`);
      if (v.environment?.startsWith("physical-") && (v.physicalDevice !== true || !text(v.device) || !text(v.browserOrRuntimeVersion))) errors.push(`${prefix}: physical evidence needs an actual device and runtime version.`);
      if (v.environment?.startsWith("authenticated-") && v.authenticated !== true) errors.push(`${prefix}: signed-in proof must be explicit.`);
    }
    const current = v.state === "passed" && v.revision === revision;
    if (item.status === "verified" && !current && requireCurrent) errors.push(`${prefix}: verification belongs to another revision or is missing.`);
    if (requireCurrent && !current) errors.push(`${prefix}: current candidate verification has not passed.`);
    records.push({ id: item.id, declaredStatus: item.status, verification: v.state === "passed" && v.revision !== revision ? "historical" : v.state, verifiedCurrent: current, environment: v.environment || null, evidenceRevision: v.revision || null });
  }
  return { ok: !errors.length, candidateRevision: revision, errors, records, scope: "Evidence consistency; referenced artifacts and remote services have not been independently retrieved." };
}

export function validateEnvironmentEvidence(document, { revision, now = new Date().toISOString() } = {}) {
  const errors = [];
  if (!sha(revision)) errors.push("An exact candidate revision is required.");
  if (document?.schemaVersion !== 1 || !Array.isArray(document?.environments)) errors.push("Environment evidence needs schemaVersion 1 and an environment list.");
  const ids = new Set();
  for (const item of document?.environments || []) {
    if (!EVIDENCE_ENVIRONMENTS.includes(item.id) || ids.has(item.id)) errors.push(`Unknown or duplicate environment: ${item.id}`);
    ids.add(item.id);
    if (!verificationStates.has(item.state) || !text(item.nextAction)) errors.push(`${item.id}: state and next action are required.`);
    if (item.state !== "passed") continue;
    if (item.revision !== revision || !sha(item.revision) || !dated(item.executedAt, now) || !evidenceLinks(item.evidence)) errors.push(`${item.id}: current exact revision, date and evidence are required.`);
    if (item.id.startsWith("physical-") && (item.physicalDevice !== true || !text(item.device) || !text(item.browserOrRuntimeVersion))) errors.push(`${item.id}: emulation cannot establish physical-device evidence.`);
    if (item.id.startsWith("authenticated-") && item.authenticated !== true) errors.push(`${item.id}: authenticated evidence must identify a signed-in run.`);
  }
  return { ok: !errors.length, errors, outstanding: (document?.environments || []).filter((item) => item.state !== "passed").map((item) => ({ id: item.id, state: item.state, nextAction: item.nextAction })) };
}

export const DEFAULT_RELEASE_REQUIREMENTS = Object.freeze({ checks: ["tests", "typecheck", "build"], journeys: ["signed-out-navigation", "signed-in-plugins-settings"], environments: ["authenticated-production"] });

export function validateReleaseEvidence(document, { revision, now = new Date().toISOString(), requirements = DEFAULT_RELEASE_REQUIREMENTS } = {}) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const exact = (value, label) => require(sha(value) && value === revision, `${label} must identify the exact candidate revision.`);
  const proof = (item, label) => { require(dated(item?.observedAt || item?.executedAt || item?.completedAt, now), `${label} needs an execution/observation date.`); require(evidenceLinks(item?.evidence), `${label} needs evidence links.`); };
  require(document?.schemaVersion === 1, "Release schemaVersion must be 1.");
  require(document?.repository === "emzylavish-art/adrians-mind-command-os", "Release evidence belongs to another repository.");
  require(sha(revision), "An exact candidate revision is required."); exact(document?.candidateRevision, "Release candidate");
  const ci = document?.ci || {}; exact(ci.revision, "CI"); proof(ci, "CI"); require(ci.status === "passed", "CI has not passed.");
  const checks = Array.isArray(ci.checks) ? ci.checks : [];
  for (const name of requirements.checks) {
    const matching = checks.filter((check) => check.name === name);
    require(matching.length === 1, `Required CI check must occur exactly once: ${name}`);
    const check = matching[0];
    require(check?.status === "passed", `Required CI check did not pass: ${name}`);
    exact(check?.revision, `CI ${name}`); require(evidenceLinks(check?.evidence), `CI ${name} needs its result artifact.`);
  }
  const build = document?.build || {}; exact(build.revision, "Build"); proof(build, "Build"); require(build.status === "passed" && digest(build.artifactSha256) && link(build.artifactUrl), "Build needs a passed immutable artifact and SHA-256.");
  const deployment = document?.deployment || {}; exact(deployment.revision, "Deployment"); proof(deployment, "Deployment");
  require(text(deployment.id) && /^https:\/\//.test(deployment.url || "") && deployment.status === "READY", "Deployment needs an observed READY identity and URL.");
  require(digest(deployment.artifactSha256) && deployment.artifactSha256 === build.artifactSha256, "Deployment must identify the tested build artifact.");
  require(["preview", "production"].includes(deployment.environment), "Deployment environment must be explicit.");
  const database = document?.database || {}; exact(database.revision, "Database compatibility"); proof(database, "Database compatibility");
  require(database.environment === deployment.environment && database.compatibility === "verified" && Array.isArray(database.migrationIds) && database.migrationIds.every(text), "Migration compatibility must be verified for the deployment environment.");
  const alias = document?.alias || {}; exact(alias.revision, "Production alias"); proof(alias, "Production alias");
  require(alias.url === "https://adrians-mind.vercel.app" && alias.deploymentId === deployment.id && deployment.environment === "production", "The canonical production alias must point to the identified production deployment.");
  const journeys = Array.isArray(document?.journeys) ? document.journeys : [];
  for (const id of requirements.journeys) {
    const matching = journeys.filter((item) => item.id === id); const journey = matching[0];
    require(matching.length === 1 && journey?.status === "passed", `Required product journey has not passed: ${id}`);
    exact(journey?.revision, `Journey ${id}`); proof(journey, `Journey ${id}`);
    require(journey?.deploymentId === deployment.id && journey?.environment === "production", `Journey ${id} must identify this production deployment.`);
    require(journey?.authenticated === (id !== "signed-out-navigation"), `Journey ${id} needs explicit authentication state.`);
  }
  const environments = validateEnvironmentEvidence(document?.environmentEvidence, { revision, now }); errors.push(...environments.errors);
  for (const id of requirements.environments) require(document?.environmentEvidence?.environments?.some((item) => item.id === id && item.state === "passed"), `Required environment has not passed: ${id}`);
  const rollback = document?.rollback || {}; proof(rollback, "Rollback");
  require(sha(rollback.revision) && rollback.revision !== revision && text(rollback.deploymentId) && rollback.databaseCompatible === true && rollback.recoveryTested === true, "Rollback needs a distinct previous compatible release and an executed recovery check.");
  return { ok: !errors.length, candidateRevision: revision, errors, outstandingEnvironments: environments.outstanding, scope: "Validates supplied evidence consistency only. It does not deploy, authorize promotion, fetch CI logs, or prove account/provider/device behavior." };
}
