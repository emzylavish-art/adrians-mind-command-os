/** Client-safe Imagine helpers (no Node APIs). */

import { sanitizeImaginePrompt } from "./harden.ts";

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
  return sanitizeImaginePrompt(raw, 4000);
}

/** Parse `/imagine <prompt>` from composer draft. Returns null when not an imagine command. */
export function parseImagineCommand(draft: string): string | null {
  const trimmed = draft.trim();
  const match = trimmed.match(/^\/imagine(?:\s+|$)([\s\S]*)$/i);
  if (!match) return null;
  return match[1]!.trim();
}


/** Client-side cost preview (mirrors spend-ledger estimates; not billed truth). */
export const CLIENT_IMAGINE_COST_USD: Record<GrokImagineModel, number> = {
  [GROK_IMAGINE_MODEL]: 0.07,
  [GROK_IMAGINE_QUALITY_MODEL]: 0.14,
};

/** Hard cap on sequential batch edits in one user action (cost + rate-limit friendly). */
export const BATCH_EDIT_MAX = 4;

export function estimateImagineBatchCostUsd(model: GrokImagineModel, count: number): number {
  const unit = CLIENT_IMAGINE_COST_USD[model] ?? CLIENT_IMAGINE_COST_USD[GROK_IMAGINE_MODEL];
  const n = Math.max(0, Math.min(BATCH_EDIT_MAX, Math.floor(count)));
  return Math.round(unit * n * 1000) / 1000;
}

export function clampBatchEditCount(count: number): number {
  if (!Number.isFinite(count) || count < 1) return 0;
  return Math.min(BATCH_EDIT_MAX, Math.floor(count));
}
