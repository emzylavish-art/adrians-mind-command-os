import { resolveVideoApiKey } from "./xai-key.ts";

const VIDEO_START_URL = "https://api.x.ai/v1/videos/generations";
const VIDEO_MODEL = "grok-imagine-video-1.5-lite";
const REQUEST_ID = /^[A-Za-z0-9-]{8,80}$/;

export type VideoStartResult =
  | { ok: true; requestId: string; model: string; state: "pending" }
  | { ok: false; error: string; status: number };

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

export function normalizeVideoPrompt(value: unknown): { ok: true; prompt: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "Write what the video should show." };
  const prompt = value.trim().replace(/\s+/g, " ");
  if (!prompt) return { ok: false, error: "Write what the video should show." };
  if (prompt.length > 2000) return { ok: false, error: "That video prompt is too long." };
  return { ok: true, prompt };
}

export function clampVideoDuration(value: unknown): number {
  const parsed = typeof value === "number" ? value : 5;
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(15, Math.max(1, Math.round(parsed)));
}

export async function startOwnerVideo(
  input: { prompt: string; duration?: number },
  options: { fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<VideoStartResult> {
  const normalized = normalizeVideoPrompt(input.prompt);
  if (!normalized.ok) return { ok: false, error: normalized.error, status: 400 };
  const apiKey = options.apiKey ?? resolveVideoApiKey();
  if (!apiKey) return { ok: false, error: "Video generation is not configured on the server.", status: 503 };
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(VIDEO_START_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: VIDEO_MODEL,
        prompt: normalized.prompt,
        duration: clampVideoDuration(input.duration),
        aspect_ratio: "16:9",
        resolution: "480p",
      }),
    });
  } catch {
    return { ok: false, error: "Could not reach the video service.", status: 502 };
  }
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
  return { ok: true, requestId, model: VIDEO_MODEL, state: "pending" };
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
