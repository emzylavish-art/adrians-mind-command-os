import { parseImageDataUrl } from "./media/data-url.ts";

export const ACCOUNT_PHOTO_MAX_CHARS = 160_000;
export type AccountPhoto = { dataUrl: string | null; revision: string | null };

export function accountPhotoData(value: unknown): string | null {
  if (typeof value !== "string" || value.length > ACCOUNT_PHOTO_MAX_CHARS) return null;
  const parsed = parseImageDataUrl(value);
  if (!parsed.ok || !["image/jpeg", "image/png"].includes(parsed.mime)) return null;
  const normalized = `data:${parsed.mime};base64,${parsed.base64}`;
  return normalized === value ? normalized : null;
}
