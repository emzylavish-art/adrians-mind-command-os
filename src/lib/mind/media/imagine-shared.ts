/** Client-safe Imagine helpers (no Node APIs). */

/** Default Grok Imagine model (listed by GET /v1/image-generation-models). */
export const GROK_IMAGINE_MODEL = "grok-imagine-image";

/** Listed by GET /v1/image-generation-models (live 2026-11-01). */
export const GROK_IMAGINE_QUALITY_MODEL = "grok-imagine-image-quality";

export const GROK_IMAGINE_MODELS = [GROK_IMAGINE_MODEL, GROK_IMAGINE_QUALITY_MODEL] as const;
export type GrokImagineModel = (typeof GROK_IMAGINE_MODELS)[number];

export function resolveImagineModel(value: unknown): GrokImagineModel {
  return value === GROK_IMAGINE_QUALITY_MODEL ? GROK_IMAGINE_QUALITY_MODEL : GROK_IMAGINE_MODEL;
}

export const XAI_IMAGES_GENERATIONS_URL = "https://api.x.ai/v1/images/generations";
export const XAI_IMAGES_EDITS_URL = "https://api.x.ai/v1/images/edits";

/** OpenAI-style variations are not offered by xAI (POST /v1/images/variations → 405). */
export const XAI_IMAGE_VARIATIONS_SUPPORTED = false;

/** Live-probed 2026-11-01: POST /v1/images/edits accepts image_urls[]. */
export const XAI_MULTI_IMAGE_EDITS_SUPPORTED = true;

export function normalizeImaginePrompt(raw: unknown): { ok: true; prompt: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Write a prompt for Imagine." };
  const prompt = raw.trim();
  if (!prompt) return { ok: false, error: "Write a prompt for Imagine." };
  if (prompt.length > 4000) return { ok: false, error: "That Imagine prompt is too long (max 4000 characters)." };
  return { ok: true, prompt };
}

/** Parse `/imagine <prompt>` from composer draft. Returns null when not an imagine command. */
export function parseImagineCommand(draft: string): string | null {
  const trimmed = draft.trim();
  const match = trimmed.match(/^\/imagine(?:\s+|$)([\s\S]*)$/i);
  if (!match) return null;
  return match[1]!.trim();
}
