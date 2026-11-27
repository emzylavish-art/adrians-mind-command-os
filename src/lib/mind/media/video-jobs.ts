import { VIDEO_MODEL, normalizeVideoPrompt, validateVideoSettings, type VideoSettings } from "./video-settings.ts";
import type { VideoStartResult, VideoStatusResult } from "./video.ts";

export type VideoJobState = "submitting" | "accepted" | "rendering" | "interrupted" | "completed" | "failed" | "unconfirmed" | "blocked";
export type VideoJob = { ownerId: string; operationId: string; chatId: string; requestId: string; prompt: string; settings: VideoSettings; state: VideoJobState; model: string; url: string; error: string; temporary: boolean; createdAt: string; updatedAt: string; expiresAt: string | null; requestHash?: string; projectId?: string; taskId?: string };
export type VideoJobStore = {
  claim: (job: VideoJob, retryBlocked?: boolean) => Promise<boolean>;
  get: (ownerId: string, operationId: string) => Promise<VideoJob | null>;
  byRequest: (ownerId: string, requestId: string) => Promise<VideoJob | null>;
  save: (job: VideoJob) => Promise<void>;
  list: (ownerId: string) => Promise<VideoJob[]>;
};
export type VideoJobResult = { ok: true; job: VideoJob; requestId: string; state: "pending" | "done"; url?: string; model: string } | { ok: false; error: string; status: number; job?: VideoJob; state?: "failed"; approvalId?: string };
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (job: VideoJob): VideoJobResult => job.state === "failed" || job.state === "blocked" || job.state === "unconfirmed" || (job.state === "submitting" && !job.requestId)
  ? { ok: false, error: job.error || "The original submission outcome is unconfirmed. It will not be submitted again automatically.", status: 409, job, ...(["failed", "blocked"].includes(job.state) ? { state: "failed" as const } : {}) }
  : { ok: true, job, requestId: job.requestId, state: job.state === "completed" ? "done" : "pending", ...(job.url ? { url: job.url } : {}), model: job.model };

/** A digest retains exact request identity for Temporary tasks without retaining their prompt text. */
export async function videoRequestFingerprint(value: { prompt: string; settings: VideoSettings; chatId: string; temporary: boolean; projectId: string; taskId: string }): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ ...value, model: VIDEO_MODEL })));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function startVideoJob(ownerId: string, input: { operationId: string; chatId?: string; prompt: unknown; duration?: unknown; aspectRatio?: unknown; resolution?: unknown; temporary?: boolean; retryBlocked?: boolean; projectId?: string; taskId?: string }, deps: { store: VideoJobStore; start: (input: { prompt: string } & VideoSettings) => Promise<VideoStartResult>; now?: () => string }): Promise<VideoJobResult> {
  if (!OPERATION_ID.test(input.operationId)) return { ok: false, error: "A valid media operation id is required.", status: 400 };
  const prompt = normalizeVideoPrompt(input.prompt), settings = validateVideoSettings(input);
  if (!prompt.ok) return { ok: false, error: prompt.error, status: 400 };
  if (!settings.ok) return { ok: false, error: settings.error, status: 400 };
  const at = deps.now?.() || new Date().toISOString();
  const chatId = (input.chatId || "").slice(0, 200), projectId = (input.projectId || "").slice(0, 160), taskId = (input.taskId || input.operationId).slice(0, 240);
  const requestHash = await videoRequestFingerprint({ prompt: prompt.prompt, settings: settings.settings, chatId, temporary: input.temporary === true, projectId, taskId });
  let job: VideoJob = { ownerId, operationId: input.operationId, chatId, projectId, taskId, requestHash, requestId: "", prompt: input.temporary ? "" : prompt.prompt, settings: settings.settings, state: "submitting", model: "", url: "", error: "", temporary: input.temporary === true, createdAt: at, updatedAt: at, expiresAt: input.temporary ? new Date(Date.parse(at) + 24 * 60 * 60_000).toISOString() : null };
  if (!(await deps.store.claim(job))) {
    const existing = await deps.store.get(ownerId, input.operationId);
    if (existing && ((existing.requestHash && existing.requestHash !== requestHash) || existing.chatId !== job.chatId || existing.temporary !== job.temporary || (existing.settings.duration !== job.settings.duration || existing.settings.aspectRatio !== job.settings.aspectRatio || existing.settings.resolution !== job.settings.resolution) || (!job.temporary && existing.prompt !== job.prompt))) return { ok: false, error: "This operation id belongs to a different saved generation. No replacement was submitted.", status: 409, job: existing };
    if (!existing || !input.retryBlocked || existing.state !== "blocked" || existing.requestId || !existing.requestHash) return existing ? reply(existing) : { ok: false, error: "The operation could not be recovered. No new generation was dispatched.", status: 409 };
    job = { ...existing, state: "submitting", error: "", updatedAt: at };
    if (!(await deps.store.claim(job, true))) return { ok: false, error: "This unchanged operation is already being retried or its state changed. No second generation was sent.", status: 409, job: existing };
  }
  let started: VideoStartResult;
  try { started = await deps.start({ prompt: prompt.prompt, ...settings.settings }); }
  catch { started = { ok: false, error: "Submission was interrupted; the provider outcome is unconfirmed. No retry was dispatched.", status: 502 }; }
  const next: VideoJob = started.ok
    ? { ...job, requestId: started.requestId, model: started.model, state: "accepted", updatedAt: deps.now?.() || new Date().toISOString() }
    : { ...job, state: started.dispatched === false ? "blocked" : started.status >= 500 ? "unconfirmed" : "failed", error: started.error, updatedAt: deps.now?.() || new Date().toISOString() };
  try { await deps.store.save(next); }
  catch {
    // Retain the paid provider's reference in the authenticated response even
    // when durable storage fails. The client keeps it without resubmitting.
    const error = started.ok
      ? "The provider accepted this generation, but its recovery reference could not be saved on the server. The received reference is retained on this device; do not submit another generation automatically."
      : "The generation outcome could not be saved. Check the existing operation before submitting another generation.";
    return { ok: false, status: 503, error, job: { ...next, state: "unconfirmed", error } };
  }
  return started.ok ? reply(next) : { ok: false, error: next.error, status: started.status, approvalId: started.approvalId, job: next, ...(["failed", "blocked"].includes(next.state) ? { state: "failed" as const } : {}) };
}

export async function pollVideoJob(ownerId: string, identity: { operationId?: string; requestId?: string }, deps: { store: VideoJobStore; status: (requestId: string) => Promise<VideoStatusResult>; now?: () => string }): Promise<VideoJobResult> {
  const job = identity.operationId ? await deps.store.get(ownerId, identity.operationId) : identity.requestId ? await deps.store.byRequest(ownerId, identity.requestId) : null;
  if (!job || job.ownerId !== ownerId) return { ok: false, error: "This generation is not saved for the signed-in account. No provider status was requested.", status: 404 };
  if (["completed", "failed", "blocked", "unconfirmed"].includes(job.state) || !job.requestId) return reply(job);
  let status: VideoStatusResult;
  try { status = await deps.status(job.requestId); }
  catch { status = { ok: false, error: "Connection interrupted. The original provider job is still recoverable.", status: 502 }; }
  const next: VideoJob = { ...job, updatedAt: deps.now?.() || new Date().toISOString(), state: status.ok ? status.state === "done" ? "completed" : "rendering" : status.state === "failed" ? "failed" : "interrupted", error: status.ok ? "" : status.error, ...(status.ok && status.url ? { url: status.url, model: status.model || job.model } : {}) };
  try { await deps.store.save(next); }
  catch { return { ok: false, status: 503, error: "The provider status was received, but server recovery storage could not be updated. The existing operation will not be resubmitted.", job: next }; }
  if (!status.ok) return { ok: false, error: status.error, status: status.status, job: next, ...(next.state === "failed" ? { state: "failed" as const } : {}) };
  return reply(next);
}

export function videoRetentionLabel(job: Pick<VideoJob, "temporary" | "url">, deviceCopy: boolean): string {
  if (deviceCopy) return "Saved on this account's device storage. This is not a cloud backup.";
  if (job.temporary) return "Temporary result. No permanent media copy is retained; recovery metadata expires within 24 hours.";
  return job.url ? "Provider link only; it can expire. No permanent video copy is retained until you explicitly save one." : "The provider job is recorded for recovery; no completed video file has been saved.";
}
