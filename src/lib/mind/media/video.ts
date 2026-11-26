import { dispatchContext, reserveDispatchAttempt, settleDispatchResult, type ReserveDispatch, type SettleDispatch } from "../dispatch-attempt.ts";
import { resolveVideoApiKey } from "./xai-key.ts";
import { VIDEO_MODEL, normalizeVideoPrompt, validateVideoSettings, type VideoSettings } from "./video-settings.ts";
export { VIDEO_MODEL, normalizeVideoPrompt, clampVideoDuration, validateVideoSettings } from "./video-settings.ts";
export type { VideoSettings } from "./video-settings.ts";

const VIDEO_START_URL = "https://api.x.ai/v1/videos/generations";
const REQUEST_ID = /^[A-Za-z0-9-]{8,80}$/;

export type VideoStartResult =
  | { ok: true; requestId: string; model: string; state: "pending" }
  | { ok: false; error: string; status: number; dispatched?: boolean; approvalId?: string };

export type VideoStatusResult =
  | { ok: true; state: "pending" | "done"; url?: string; model?: string }
  | { ok: false; error: string; status: number; state?: "failed" };

function publicError(value: string): string {
  return value.replace(/xai-[A-Za-z0-9_-]+/g, "[key]").replace(/\s+/g, " ").trim().slice(0, 240);
}

function errorMessage(body: unknown, status: number, fallback: string): string {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const err = record.error;
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
        ? String((err as { message: string }).message)
        : fallback;
  return publicError(raw || `Video generation failed (HTTP ${status}).`);
}

export async function startOwnerVideo(
  input: { prompt: string; duration?: number; aspectRatio?: VideoSettings["aspectRatio"]; resolution?: VideoSettings["resolution"] },
  options: { fetchImpl?: typeof fetch; apiKey?: string; ownerId?: string; operationId?: string; taskId?: string; projectId?: string; reserve?: ReserveDispatch; settle?: SettleDispatch } = {},
): Promise<VideoStartResult> {
  const normalized = normalizeVideoPrompt(input.prompt);
  if (!normalized.ok) return { ok: false, error: normalized.error, status: 400, dispatched: false };
  const validated = validateVideoSettings(input);
  if (!validated.ok) return { ok: false, error: validated.error, status: 400, dispatched: false };
  const apiKey = options.apiKey ?? resolveVideoApiKey();
  if (!apiKey) return { ok: false, error: "Video generation is not configured on the server.", status: 503, dispatched: false };
  const context = dispatchContext({ operationId: options.operationId, taskId: options.taskId, projectId: options.projectId, provider: "xai", model: VIDEO_MODEL, stage: "video-start", args: { prompt: normalized.prompt, ...validated.settings }, textOnly: false });
  const reserved = options.ownerId ? await reserveDispatchAttempt(options.ownerId, context, options.reserve) : { ok: true as const, reservationId: undefined };
  if (!reserved.ok) return { ok: false, error: reserved.error, status: reserved.status, approvalId: reserved.approvalId, dispatched: false };
  let completed = false;
  let providerRequestId: string | null = null;
  try {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(VIDEO_START_URL, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: VIDEO_MODEL,
        prompt: normalized.prompt,
        duration: validated.settings.duration,
        aspect_ratio: validated.settings.aspectRatio,
        resolution: validated.settings.resolution,
      }),
    });
  } catch {
    return { ok: false, error: "Could not reach the video service.", status: 502 };
  }
  providerRequestId = response.headers.get("x-request-id");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "Video generation returned a response that could not be read.", status: response.status || 502 };
  }
  if (!response.ok) {
    return { ok: false, error: errorMessage(body, response.status, "Video generation did not start."), status: response.status };
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const requestId = typeof record.request_id === "string" ? record.request_id : "";
  if (!REQUEST_ID.test(requestId)) {
    return { ok: false, error: "Video generation did not return a request.", status: 502 };
  }
  completed = true;
  providerRequestId = requestId;
  return { ok: true, requestId, model: VIDEO_MODEL, state: "pending" };
  } finally {
    await settleDispatchResult(options.ownerId || "", reserved.reservationId, { ok: completed, requestId: providerRequestId }, options.settle);
  }
}

export async function readOwnerVideo(
  requestId: string,
  options: { fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<VideoStatusResult> {
  if (!REQUEST_ID.test(requestId)) return { ok: false, error: "That video request is not recognized.", status: 400 };
  const apiKey = options.apiKey ?? resolveVideoApiKey();
  if (!apiKey) return { ok: false, error: "Video generation is not configured on the server.", status: 503 };
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`https://api.x.ai/v1/videos/${encodeURIComponent(requestId)}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, error: "Could not reach the video service.", status: 502 };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "Video status could not be read.", status: response.status || 502 };
  }
  if (!response.ok) {
    return { ok: false, error: errorMessage(body, response.status, "Video status could not be read."), status: response.status };
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const state = record.status === "done" || record.status === "failed" || record.status === "pending" ? record.status : "pending";
  if (state === "failed") {
    return { ok: false, error: errorMessage(body, 502, "Video generation failed."), status: 502, state: "failed" };
  }
  if (state === "done") {
    const video = record.video && typeof record.video === "object" ? (record.video as Record<string, unknown>) : {};
    const url = typeof video.url === "string" ? video.url : "";
    if (!url.startsWith("https://")) return { ok: false, error: "The video finished without a playable link.", status: 502 };
    return { ok: true, state: "done", url, model: typeof record.model === "string" ? record.model : VIDEO_MODEL };
  }
  return { ok: true, state: "pending" };
}
