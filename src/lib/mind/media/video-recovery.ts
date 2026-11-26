import { VIDEO_MODEL, validateVideoSettings, type VideoSettings } from "./video-settings.ts";
import type { VideoJob, VideoJobResult } from "./video-jobs.ts";

export const VIDEO_RECOVERY_KEY = "amcos.video-jobs.v1";
export type VideoClientContext = {
  ownerId: string; currentOwner: () => string | null;
  storage: Pick<Storage, "getItem" | "setItem">;
  endpoint?: string; bearer?: string | null; signal?: AbortSignal; fetchImpl?: typeof fetch;
};
const owns = (context: VideoClientContext) => context.currentOwner() === context.ownerId && !context.signal?.aborted;
const canceled = (): VideoJobResult => ({ ok: false, status: 409, error: "The media operation belongs to a different or closed session. No result was committed." });

export function readVideoRecovery(storage: Pick<Storage, "getItem">, ownerId: string): VideoJob[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(VIDEO_RECOVERY_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is VideoJob => Boolean(item && typeof item === "object" && item.ownerId === ownerId && typeof item.operationId === "string" && typeof item.chatId === "string" && typeof item.requestId === "string" && typeof item.state === "string" && item.settings && typeof item.createdAt === "string" && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()))).slice(0, 100);
  } catch { return []; }
}
export function rememberVideoJob(context: VideoClientContext, job: VideoJob) {
  if (!owns(context) || job.ownerId !== context.ownerId) return false;
  const current = readVideoRecovery(context.storage, context.ownerId);
  context.storage.setItem(VIDEO_RECOVERY_KEY, JSON.stringify([job, ...current.filter(item => item.operationId !== job.operationId)].slice(0, 100)));
  return true;
}

/** A server list can omit a start whose response was lost before its durable claim. */
export function mergeVideoRecovery(local: VideoJob[], saved: VideoJob[], ownerId: string): VideoJob[] {
  const merged = new Map(local.filter(job => job.ownerId === ownerId).map(job => [job.operationId, job]));
  for (const job of saved) if (job.ownerId === ownerId) {
    const previous = merged.get(job.operationId);
    // A pre-dispatch server claim must not erase a provider reference that was
    // returned to this client when the later server persistence failed.
    if (!(previous?.state === "unconfirmed" && previous.requestId && !job.requestId && job.state === "submitting")) merged.set(job.operationId, job);
  }
  return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}

async function request(context: VideoClientContext, body: Record<string, unknown>): Promise<VideoJobResult> {
  const response = await (context.fetchImpl || fetch)(context.endpoint || "/api/mind/media/generate", { method: "POST", credentials: "include", signal: context.signal, headers: { "content-type": "application/json", ...(context.bearer ? { authorization: `Bearer ${context.bearer}` } : {}) }, body: JSON.stringify({ kind: "video", ...body }) });
  const result = await response.json() as VideoJobResult;
  if (!result.ok && !result.status) return { ...result, status: response.status || 502 };
  return result;
}

/** The operation reference is saved before submission; this function never retries a start. */
export async function beginRecoverableVideo(input: { operationId?: string; chatId: string; prompt: string; settings: VideoSettings; temporary: boolean; freeOnly?: boolean; projectId?: string; taskId?: string }, context: VideoClientContext): Promise<VideoJobResult> {
  if (!owns(context)) return canceled();
  if (input.freeOnly) return { ok: false, status: 403, error: "Free-only mode prevents a paid video generation." };
  const settings = validateVideoSettings(input.settings);
  if (!settings.ok) return { ok: false, status: 400, error: settings.error };
  const at = new Date().toISOString();
  const job: VideoJob = { projectId: input.projectId, taskId: input.taskId, ownerId: context.ownerId, operationId: input.operationId || crypto.randomUUID(), chatId: input.chatId, requestId: "", prompt: input.temporary ? "" : input.prompt, settings: settings.settings, state: "submitting", model: VIDEO_MODEL, url: "", error: "", temporary: input.temporary, createdAt: at, updatedAt: at, expiresAt: input.temporary ? new Date(Date.now() + 24 * 60 * 60_000).toISOString() : null };
  try { rememberVideoJob(context, job); }
  catch { return { ok: false, status: 503, error: "Recovery storage is unavailable. The generation was not submitted." }; }
  try {
    const result = await request(context, { action: "start", operationId: job.operationId, projectId: input.projectId, taskId: input.taskId, chatId: job.chatId, prompt: input.prompt, ...settings.settings, temporary: input.temporary, freeOnly: false });
    if (!owns(context)) return canceled();
    if (result.job) rememberVideoJob(context, result.job);
    return result;
  } catch {
    if (!owns(context)) return canceled();
    const pending = { ...job, state: "unconfirmed" as const, error: "The start response was interrupted. Check the saved operation before considering another paid generation." };
    rememberVideoJob(context, pending);
    return { ok: false, status: 502, error: pending.error, job: pending };
  }
}

/** Explicit retry is permitted only for a proven unsent blocked task, with the original immutable request. */
export async function retryBlockedVideo(job: VideoJob, context: VideoClientContext, input: { temporaryPrompt?: string; freeOnly?: boolean } = {}): Promise<VideoJobResult> {
  if (!owns(context) || job.ownerId !== context.ownerId) return canceled();
  if (job.state !== "blocked" || job.requestId || !job.requestHash) return { ok: false, status: 409, error: "Only a recorded request that never reached the provider can be explicitly retried." };
  if (input.freeOnly) return { ok: false, status: 403, error: "Free-only mode prevents paid video generation." };
  const prompt = job.temporary ? input.temporaryPrompt?.trim() : job.prompt;
  if (!prompt) return { ok: false, status: 400, error: "Re-enter the original temporary prompt to retry its reviewed request. Its text was not saved." };
  try {
    const result = await request(context, { action: "retry_blocked", operationId: job.operationId, projectId: job.projectId, taskId: job.taskId, chatId: job.chatId, prompt, ...job.settings, temporary: job.temporary, freeOnly: false });
    if (!owns(context)) return canceled();
    if (result.job) rememberVideoJob(context, result.job);
    return result;
  } catch {
    if (!owns(context)) return canceled();
    const pending = { ...job, state: "unconfirmed" as const, error: "The explicit retry response was lost. Check this same operation; no automatic retry was started." };
    rememberVideoJob(context, pending);
    return { ok: false, status: 502, error: pending.error, job: pending };
  }
}

async function delay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return;
  await new Promise<void>(resolve => {
    const end = () => { clearTimeout(timer); signal?.removeEventListener("abort", end); resolve(); };
    const timer = setTimeout(end, ms); signal?.addEventListener("abort", end, { once: true });
  });
}

/** Recovery performs status checks only, including after transient errors and reload. */
export async function pollRecoverableVideo(initial: VideoJob, context: VideoClientContext, options: { maxChecks?: number; wait?: (ms: number, signal?: AbortSignal) => Promise<void>; onUpdate?: (job: VideoJob) => void } = {}): Promise<VideoJobResult> {
  if (!owns(context) || initial.ownerId !== context.ownerId) return canceled();
  let job = initial, failures = 0;
  const maxChecks = Math.min(96, Math.max(1, options.maxChecks || 96));
  for (let check = 0; check < maxChecks; check++) {
    if (!owns(context)) return canceled();
    if (check) await (options.wait || delay)(Math.min(30_000, 5_000 * 2 ** Math.min(failures, 3)), context.signal);
    if (!owns(context)) return canceled();
    let result: VideoJobResult;
    try { result = await request(context, { action: "status", operationId: job.operationId }); }
    catch { result = { ok: false, status: 502, error: "The status check was interrupted. The saved operation remains recoverable." }; }
    if (!owns(context)) return canceled();
    if (result.job && result.job.ownerId === context.ownerId && result.job.operationId === job.operationId) job = mergeVideoRecovery([job], [result.job], context.ownerId)[0];
    else if (result.ok) return { ok: false, status: 502, error: "The status response did not identify this account's saved operation." };
    if (result.ok) failures = 0;
    else { failures++; if (!["failed", "unconfirmed"].includes(job.state)) job = { ...job, state: "interrupted", error: result.error }; }
    rememberVideoJob(context, job); options.onUpdate?.(job);
    if (result.ok && result.state === "done") return result;
    if (!result.ok && (result.state === "failed" || result.job?.state === "unconfirmed" || [400, 401, 403, 404, 409].includes(result.status) || failures >= 6)) return { ...result, job };
  }
  return { ok: false, status: 408, error: "Status checks paused after the bounded recovery window. Resume this saved operation later; no new generation was submitted.", job };
}
