import { normalizeSkillReceipts, type SkillApplicationReceipt } from "../skill-activation.ts";
import { isShareId } from "../app-location.ts";
import type { Workspace } from "../types.ts";
import { buildBranchName, buildRunId, workStorageKey } from "./build-scope.ts";
import { readBuildArtifactStatus, type BuildArtifactStatus } from "./build-artifact.ts";

export type BuildStoredJob = { id: string; status: "queued" | "running" | "cancel_requested" | "cancelled" | "done" | "error" | "timeout"; output: string; error: string; createdAt: string; updatedAt: string };
export type BuildStoredReceipt = {
  operationId?: string; outputComplete?: boolean; requestDispatched?: boolean;
  verifiedBranch?: string;
  artifact?: BuildArtifactStatus;
  fileReviewScope?: string; fileReviewWarnings?: string[];
  filesChanged?: { path: string; before: string; after: string; previousPath?: string; beforeExists?: boolean; afterExists?: boolean }[];
  skillReceipts?: SkillApplicationReceipt[];
  verification?: { implementation: string; builderInstructionDigest?: string; checks: { id: string; status: string }[] };
  toolReceipts?: { method: string; path?: string; status: string; detail?: string; durable?: boolean }[];
};
export type BuildReturnSource = { chatId: string; runId: string; runtime: "hosted" | "paired" };
export type BuildStoredResult = { owner: string; projectId?: string | null; job: BuildStoredJob; receipt: BuildStoredReceipt | null; source?: BuildReturnSource };
export const MAX_BUILD_RESULT_CHARACTERS = 4_000_000;
export const buildResultKey = (owner: string, projectId: string | null = null) => workStorageKey(owner, projectId, "result", `amcos.build-result.v1.${encodeURIComponent(owner)}`);

export function readBuildReturnSource(value: unknown): BuildReturnSource | undefined {
  const source = value as Partial<BuildReturnSource> | null;
  if (!isShareId(source?.chatId) || !buildRunId(source.runId) || (source.runtime !== "hosted" && source.runtime !== "paired")) return undefined;
  return { chatId: source.chatId, runId: source.runId, runtime: source.runtime };
}

export function canReturnBuildResult(job: BuildStoredJob | null, source: BuildReturnSource | undefined) {
  return Boolean(job?.status === "done" && source && job.id === (source.runtime === "paired" ? source.runId : "local"));
}

/** The message points to a separately preserved receipt and cannot overwrite an existing turn. */
export function appendBuildResultToChat(workspace: Workspace, projectId: string | null, source: BuildReturnSource, job: BuildStoredJob, href: string): Workspace | null {
  if (!canReturnBuildResult(job, source)) return null;
  const chat = workspace.chats.find(item => item.id === source.chatId);
  if (!chat || chat.temporary || chat.archived || chat.projectId !== projectId) return null;
  const id = `build-result-${source.runId}`;
  if (chat.messages.some(message => message.id === id)) return workspace;
  const content = `Build run completed. Review the recorded output and any file changes before accepting the implementation.\n\n[Open Build run](${href})`;
  return { ...workspace, chats: workspace.chats.map(item => item === chat ? { ...chat, messages: [...chat.messages, { id, role: "assistant", content, at: job.updatedAt }] } : item) };
}

/** The write and recovery limits are identical. A large receipt is never silently skipped or truncated. */
export function serializeBuildResult(result: BuildStoredResult): string {
  const raw = JSON.stringify(result);
  if (raw.length > MAX_BUILD_RESULT_CHARACTERS) throw new Error("This Build receipt exceeds browser recovery storage. Download the complete receipt before leaving; the previous saved receipt was preserved.");
  return raw;
}

export function parseBuildResult(raw: string | null, owner: string, projectId: string | null = null): BuildStoredResult | null {
  if (!raw) return null;
  if (raw.length > MAX_BUILD_RESULT_CHARACTERS) throw new Error("The saved Build receipt exceeds the supported recovery limit. It was retained in storage; do not repeat the task before recovering the record.");
  const saved = JSON.parse(raw);
  if (!saved || saved.owner !== owner || (saved.projectId ?? null) !== projectId || typeof saved.job?.id !== "string" || (saved.job.id !== "local" && !/^[a-f0-9]{16,64}$/.test(saved.job.id))) return null;
  const job = saved.job;
  const statuses = job.id === "local" ? ["done", "error", "timeout", "cancelled"] : ["queued", "running", "cancel_requested", "done", "error", "timeout", "cancelled"];
  if (typeof job.output !== "string" || typeof job.error !== "string" || typeof job.createdAt !== "string" || typeof job.updatedAt !== "string" || !statuses.includes(job.status)) throw new Error("The saved Build result is incomplete. It was kept for recovery; no completed outcome was assumed.");
  const source = saved.receipt;
  const returnSource = readBuildReturnSource(saved.source);
  const resultScope = { owner, ...(projectId ? { projectId } : {}), ...(returnSource ? { source: returnSource } : {}) };
  if (source == null) return { ...resultScope, job, receipt: null };
  if (typeof source !== "object" || Array.isArray(source)) throw new Error("The saved Build receipt is unreadable. Its source was retained in storage.");
  const receipt: BuildStoredReceipt = {};
  if (typeof source.operationId === "string") receipt.operationId = source.operationId;
  if (buildBranchName(source.verifiedBranch)) receipt.verifiedBranch = source.verifiedBranch;
  const artifact = readBuildArtifactStatus(source.artifact);
  if (artifact) receipt.artifact = artifact;
  if (typeof source.outputComplete === "boolean") receipt.outputComplete = source.outputComplete;
  if (typeof source.requestDispatched === "boolean") receipt.requestDispatched = source.requestDispatched;
  if (typeof source.fileReviewScope === "string") receipt.fileReviewScope = source.fileReviewScope;
  if (Array.isArray(source.fileReviewWarnings) && source.fileReviewWarnings.every((row: unknown) => typeof row === "string")) receipt.fileReviewWarnings = source.fileReviewWarnings;
  if (source.filesChanged !== undefined) {
    if (!Array.isArray(source.filesChanged) || source.filesChanged.some((file: Record<string, unknown>) => !file || typeof file.path !== "string" || typeof file.before !== "string" || typeof file.after !== "string")) throw new Error("The stored change review is incomplete. It was retained without inventing missing file evidence.");
    receipt.filesChanged = source.filesChanged.map((file: Record<string, unknown>) => ({ path: file.path as string, before: file.before as string, after: file.after as string, ...(typeof file.previousPath === "string" ? { previousPath: file.previousPath } : {}), ...(typeof file.beforeExists === "boolean" ? { beforeExists: file.beforeExists } : {}), ...(typeof file.afterExists === "boolean" ? { afterExists: file.afterExists } : {}) }));
  }
  receipt.skillReceipts = normalizeSkillReceipts(source.skillReceipts);
  if (source.verification && typeof source.verification === "object") {
    if (typeof source.verification.implementation !== "string" || !Array.isArray(source.verification.checks) || source.verification.checks.some((check: Record<string, unknown>) => !check || typeof check.id !== "string" || typeof check.status !== "string")) throw new Error("The stored verification receipt is incomplete. No check was assumed to pass.");
    receipt.verification = { implementation: source.verification.implementation, checks: source.verification.checks.map((check: { id: string; status: string }) => ({ id: check.id, status: check.status })), ...(typeof source.verification.builderInstructionDigest === "string" ? { builderInstructionDigest: source.verification.builderInstructionDigest } : {}) };
  }
  if (source.toolReceipts !== undefined) {
    if (!Array.isArray(source.toolReceipts) || source.toolReceipts.some((row: Record<string, unknown>) => !row || typeof row.method !== "string" || typeof row.status !== "string")) throw new Error("The stored tool receipt is incomplete. No tool success was assumed.");
    receipt.toolReceipts = source.toolReceipts.map((row: Record<string, unknown>) => ({ method: row.method as string, status: row.status as string, ...(typeof row.path === "string" ? { path: row.path } : {}), ...(typeof row.detail === "string" ? { detail: row.detail } : {}), ...(typeof row.durable === "boolean" ? { durable: row.durable } : {}) }));
  }
  return { ...resultScope, job, receipt };
}
