import { normalizeSkillReceipts } from "../skill-activation.ts";
import type { PcJob } from "../pc-pairing/store.ts";
import { isShareId } from "../app-location.ts";
import { readBuildReturnSource, type BuildStoredReceipt, type BuildStoredResult } from "./build-result.ts";
import { buildArtifactName, readBuildArtifactStatus } from "./build-artifact.ts";

/** The immutable job payload carries selection reasons, never a claim that a tool ran. */
export function pairedBuildPayload(prompt: string, skillReceipts: unknown, cwd?: string): Record<string, unknown> {
  return { prompt, cwd, skillReceipts: normalizeSkillReceipts(skillReceipts) ?? [] };
}

/** Only an owning account can recover the queue's original instruction-selection receipt. */
export function pairedBuildReceipt(job: Pick<PcJob, "id" | "ownerId" | "kind" | "payload" | "buildArtifact"> | null, ownerId: string): BuildStoredReceipt | null {
  if (!job || job.ownerId !== ownerId || job.kind !== "kimi-acp") return null;
  const artifact = readBuildArtifactStatus(job.buildArtifact);
  return {
    operationId: job.id,
    ...(artifact ? { artifact } : {}),
    skillReceipts: normalizeSkillReceipts(job.payload?.skillReceipts) ?? [],
    verification: {
      implementation: "unverified",
      checks: [
        { id: "paired_job_record", status: "saved" },
        { id: "provider_execution", status: "unverified" },
        { id: "tool_execution", status: "unverified" },
        { id: "task_output", status: "unverified" },
      ],
    },
    fileReviewScope: "Skill instruction inclusion describes the queued task context. Queue acceptance and a paired computer's completion report do not prove model adherence, tool execution, or implementation correctness. Review the separate job events and changed files.",
  };
}

export function pairedBuildReviewScope(projectId: unknown, chatId: unknown, runId: unknown) {
  const source = readBuildReturnSource({ chatId, runId, runtime: "paired" });
  if (!source || (projectId != null && (typeof projectId !== "string" || !isShareId(projectId)))) return null;
  return { projectId: typeof projectId === "string" ? projectId : null, source };
}

export function pairedBuildRunResult(job: PcJob, ownerId: string, projectId: string | null): BuildStoredResult | null {
  if (job.ownerId !== ownerId || job.kind !== "kimi-acp" || job.status !== "done") return null;
  const scope = job.payload?.reviewScope as Record<string, unknown> | undefined;
  const source = readBuildReturnSource(scope?.source);
  if (!scope || scope.projectId !== projectId) return null;
  if (source ? source.runtime !== "paired" || source.runId !== job.id : scope.source !== null || !buildArtifactName(job.payload?.artifactName)) return null;
  return {
    owner: ownerId, projectId, source, receipt: pairedBuildReceipt(job, ownerId),
    job: { id: job.id, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt, output: job.output || "", error: job.error || "" },
  };
}
