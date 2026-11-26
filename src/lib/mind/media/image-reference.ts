import { normalizeImageDataUrl } from "./data-url.ts";
import { safeImageLineage, type ImageEditLineage } from "./image-metadata.ts";
import type { ImageRef } from "./blob-store.ts";

export type EditableImage = { dataUrl: string; imageId: string; lineage?: ImageEditLineage };
export async function resolveEditableImage(input: { source: string | ImageRef; ownerId: string; currentOwner: () => string | null; authorizedImages: ImageRef[]; getOwnedBlob: (id: string) => Promise<string | undefined> }): Promise<{ ok: true; image: EditableImage } | { ok: false; error: string }> {
  if (!input.ownerId || input.currentOwner() !== input.ownerId) return { ok: false, error: "The image belongs to a closed account session." };
  const candidate = typeof input.source === "string" ? input.authorizedImages.find(image => image.blobId === input.source || image.dataUrl === input.source) || { dataUrl: input.source } : input.source;
  let dataUrl = candidate.dataUrl || "";
  if (!dataUrl.startsWith("data:image/") && candidate.blobId) {
    if (!input.authorizedImages.some(image => image.blobId === candidate.blobId)) return { ok: false, error: "This image reference is not present in the account's current workspace." };
    dataUrl = await input.getOwnedBlob(candidate.blobId) || "";
  }
  if (input.currentOwner() !== input.ownerId) return { ok: false, error: "The account changed while resolving the image. Nothing was sent." };
  const normalized = normalizeImageDataUrl(dataUrl);
  if (!normalized) return { ok: false, error: "The image is unavailable or unsupported. Use embedded image data or this account's stored image reference; external URLs are not fetched by the editor." };
  const lineage = safeImageLineage(candidate.lineage);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (input.currentOwner() !== input.ownerId) return { ok: false, error: "The account changed while preparing the image. Nothing was sent." };
  return { ok: true, image: { dataUrl: normalized, imageId: lineage?.imageId || candidate.blobId || `image:${fingerprint}`, ...(lineage ? { lineage } : {}) } };
}

export function imageEditLineage(source: EditableImage, prompt: string, model: string, now = new Date().toISOString(), editId: string = crypto.randomUUID()): ImageEditLineage {
  return { imageId: `edit:${editId}`, parentImageId: source.imageId, rootImageId: source.lineage?.rootImageId || source.imageId, editId, version: (source.lineage?.version || 0) + 1, prompt: prompt.slice(0, 2000), model: model.slice(0, 200), createdAt: now };
}
