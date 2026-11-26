/** Adapter profile: https://docs.x.ai/developers/model-capabilities/video/generation */
export const VIDEO_MODEL = "grok-imagine-video-1.5-lite";
export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9", "5:2"] as const;
export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export type VideoSettings = { duration: number; aspectRatio: (typeof VIDEO_ASPECT_RATIOS)[number]; resolution: (typeof VIDEO_RESOLUTIONS)[number] };
export const DEFAULT_VIDEO_SETTINGS: VideoSettings = { duration: 5, aspectRatio: "16:9", resolution: "480p" };
export const VIDEO_SETTINGS_KEY = "amcos.video-settings.v1";
export type VideoCapabilities = { model: string; durations: readonly number[]; aspectRatios: readonly VideoSettings["aspectRatio"][]; resolutions: readonly VideoSettings["resolution"][]; source: string };
export const VIDEO_CAPABILITIES: VideoCapabilities = { model: VIDEO_MODEL, durations: Array.from({ length: 15 }, (_, index) => index + 1), aspectRatios: VIDEO_ASPECT_RATIOS, resolutions: VIDEO_RESOLUTIONS, source: "https://docs.x.ai/developers/model-capabilities/video/generation" };
/** Only declared values supported by this adapter are offered; unknown/new values never widen its request contract. */
export function videoSettingOptions(capabilities: VideoCapabilities = VIDEO_CAPABILITIES) {
  return {
    durations: [...new Set(capabilities.durations.filter(value => Number.isInteger(value) && value >= 1 && value <= 15))].sort((a, b) => a - b),
    aspectRatios: [...new Set(capabilities.aspectRatios.filter(value => VIDEO_ASPECT_RATIOS.includes(value)))],
    resolutions: [...new Set(capabilities.resolutions.filter(value => VIDEO_RESOLUTIONS.includes(value)))],
  };
}

export function validateVideoSettings(value: { duration?: unknown; aspectRatio?: unknown; resolution?: unknown }, capabilities: VideoCapabilities = VIDEO_CAPABILITIES): { ok: true; settings: VideoSettings } | { ok: false; error: string } {
  const duration = value.duration ?? DEFAULT_VIDEO_SETTINGS.duration;
  const aspectRatio = value.aspectRatio ?? DEFAULT_VIDEO_SETTINGS.aspectRatio;
  const resolution = value.resolution ?? DEFAULT_VIDEO_SETTINGS.resolution;
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 15) return { ok: false, error: "Video duration must be a whole number from 1 to 15 seconds." };
  const offered = videoSettingOptions(capabilities);
  if (!offered.durations.includes(duration)) return { ok: false, error: "That duration is not declared by the selected video adapter. Choose a supported value explicitly." };
  if (!(offered.aspectRatios as readonly unknown[]).includes(aspectRatio)) return { ok: false, error: "That aspect ratio is not supported by the selected video adapter." };
  if (!(offered.resolutions as readonly unknown[]).includes(resolution)) return { ok: false, error: "That resolution is not supported by the selected video adapter." };
  return { ok: true, settings: { duration, aspectRatio: aspectRatio as VideoSettings["aspectRatio"], resolution: resolution as VideoSettings["resolution"] } };
}

export function loadVideoSettings(storage: Pick<Storage, "getItem">): VideoSettings {
  try { const raw = JSON.parse(storage.getItem(VIDEO_SETTINGS_KEY) || "{}"); const parsed = validateVideoSettings(raw); return parsed.ok ? parsed.settings : { ...DEFAULT_VIDEO_SETTINGS }; }
  catch { return { ...DEFAULT_VIDEO_SETTINGS }; }
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
  return Number.isFinite(parsed) ? Math.min(15, Math.max(1, Math.round(parsed))) : 5;
}
