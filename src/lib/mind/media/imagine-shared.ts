/** Client-safe Imagine helpers (no Node APIs). */

import { sanitizeImaginePrompt } from "./harden.ts";

/** Default Grok Imagine model (listed by GET /v1/image-generation-models). */
export const GROK_IMAGINE_MODEL = "grok-imagine-image";

/** xAI migrated the retired quality alias to Imagine 2.0 at low quality. */
export const GROK_IMAGINE_QUALITY_MODEL = "grok-imagine-image-2.0";

export const GROK_IMAGINE_MODELS = [GROK_IMAGINE_MODEL, GROK_IMAGINE_QUALITY_MODEL] as const;
export type GrokImagineModel = (typeof GROK_IMAGINE_MODELS)[number];

export function resolveImagineModel(value: unknown): GrokImagineModel {
  return value === GROK_IMAGINE_QUALITY_MODEL || value === "grok-imagine-image-quality" ? GROK_IMAGINE_QUALITY_MODEL : GROK_IMAGINE_MODEL;
}

export const XAI_IMAGES_GENERATIONS_URL = "https://api.x.ai/v1/images/generations";
export const XAI_IMAGES_EDITS_URL = "https://api.x.ai/v1/images/edits";

/** OpenAI-style variations are not offered by xAI (POST /v1/images/variations → 405). */
export const XAI_IMAGE_VARIATIONS_SUPPORTED = false;

/** Live-probed 2026-11-01: POST /v1/images/edits accepts image_urls[]. */
export const XAI_MULTI_IMAGE_EDITS_SUPPORTED = true;

export function normalizeImaginePrompt(raw: unknown): { ok: true; prompt: string } | { ok: false; error: string } {
  return sanitizeImaginePrompt(raw, 4000);
}

/** Parse `/imagine <prompt>` from composer draft. Returns null when not an imagine command. */
export function parseImagineCommand(draft: string): string | null {
  const trimmed = draft.trim();
  const match = trimmed.match(/^\/imagine(?:\s+|$)([\s\S]*)$/i);
  if (!match) return null;
  return match[1]!.trim();
}
