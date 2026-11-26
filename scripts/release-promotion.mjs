import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readEvidenceFile, validateReleaseEvidence } from "./release-evidence.mjs";

export function planReleasePreparation({ report, revision, actualRevision, dirty, approved }) {
  const result = validateReleaseEvidence(report, { revision });
  const errors = [...result.errors];
  if (!approved) errors.push("Schema preparation requires explicit --apply-compatible-migrations authorization.");
  if (actualRevision !== revision || dirty) errors.push("The executing checkout must be clean and at the verified candidate revision.");
  return { ok: errors.length === 0, errors, command: errors.length ? null : [process.execPath, "scripts/migrate.mjs"] };
}

// Builds and previews never call this entrypoint. It prepares compatible schema;
// release promotion remains a separate, explicit platform action.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  try {
    const revision = option("--revision");
    const plan = planReleasePreparation({ report: readEvidenceFile(option("--report")), revision, actualRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim()), approved: args.includes("--apply-compatible-migrations") });
    if (!plan.ok) { console.error(plan.errors.join("\n")); process.exitCode = 1; }
    else {
      const child = spawnSync(plan.command[0], plan.command.slice(1), { stdio: "inherit", shell: false });
      process.exitCode = child.status ?? 1;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
