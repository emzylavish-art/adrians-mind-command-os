import { normalizeSkillReceipts } from "../skill-activation.ts";
import type { PcJob } from "../pc-pairing/store.ts";
import type { BuildStoredReceipt } from "./build-result.ts";

/** The immutable job payload carries selection reasons, never a claim that a tool ran. */
export function pairedBuildPayload(prompt: string, skillReceipts: unknown, cwd?: string): Record<string, unknown> {
  return { prompt, cwd, skillReceipts: normalizeSkillReceipts(skillReceipts) ?? [] };
}

/** Only an owning account can recover the queue's original instruction-selection receipt. */
export function pairedBuildReceipt(job: Pick<PcJob, "id" | "ownerId" | "kind" | "payload"> | null, ownerId: string): BuildStoredReceipt | null {
  if (!job || job.ownerId !== ownerId || job.kind !== "kimi-acp") return null;
  return {
    operationId: job.id,
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
