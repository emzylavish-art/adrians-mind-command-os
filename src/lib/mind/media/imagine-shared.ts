/** Client-safe Imagine helpers (no Node APIs). */

/** Default Grok Imagine model (listed by GET /v1/image-generation-models). */
export const GROK_IMAGINE_MODEL = "grok-imagine-image";

export const XAI_IMAGES_GENERATIONS_URL = "https://api.x.ai/v1/images/generations";
export const XAI_IMAGES_EDITS_URL = "https://api.x.ai/v1/images/edits";

/** OpenAI-style variations are not offered by xAI (POST /v1/images/variations → 405). */
export const XAI_IMAGE_VARIATIONS_SUPPORTED = false;

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
