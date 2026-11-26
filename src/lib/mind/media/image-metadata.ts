export type ImagePreparationQuality = "data-saver" | "balanced" | "high-detail";
export type ImagePreparationReceipt = { quality: ImagePreparationQuality; originalWidth: number; originalHeight: number; width: number; height: number; compressed: boolean };
export type ImageEditLineage = { imageId: string; parentImageId: string; rootImageId: string; editId: string; version: number; prompt: string; model: string; createdAt: string };
export const IMAGE_PREPARATION_KEY = "amcos.image-preparation.v1";

export function imagePreparationProfile(quality: ImagePreparationQuality, supportedMaxEdge = 2048) {
  const maxEdge = Math.max(256, Math.min(4096, Math.floor(supportedMaxEdge)));
  return quality === "data-saver" ? { quality, maxEdge: Math.min(1024, maxEdge), jpegQualities: [0.72, 0.6, 0.45] }
    : quality === "high-detail" ? { quality, maxEdge, jpegQualities: [0.95, 0.9, 0.85, 0.72] }
    : { quality, maxEdge: Math.min(2048, maxEdge), jpegQualities: [0.85, 0.72, 0.58, 0.45] };
}
export function loadImagePreparationQuality(storage: Pick<Storage, "getItem">): ImagePreparationQuality {
  try { const value = storage.getItem(IMAGE_PREPARATION_KEY); return value === "data-saver" || value === "high-detail" ? value : "balanced"; } catch { return "balanced"; }
}
export function safeImagePreparation(value: unknown): ImagePreparationReceipt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (!["data-saver", "balanced", "high-detail"].includes(String(row.quality)) || ![row.originalWidth, row.originalHeight, row.width, row.height].every(n => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 65_536) || typeof row.compressed !== "boolean") return undefined;
  return { quality: row.quality as ImagePreparationQuality, originalWidth: Number(row.originalWidth), originalHeight: Number(row.originalHeight), width: Number(row.width), height: Number(row.height), compressed: row.compressed };
}
export function safeImageLineage(value: unknown): ImageEditLineage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (![row.imageId, row.parentImageId, row.rootImageId, row.editId].every(id => typeof id === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(id)) || typeof row.version !== "number" || !Number.isInteger(row.version) || row.version < 1 || row.version > 10_000 || typeof row.prompt !== "string" || row.prompt.length > 2000 || typeof row.model !== "string" || row.model.length > 200 || typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt))) return undefined;
  return { imageId: String(row.imageId), parentImageId: String(row.parentImageId), rootImageId: String(row.rootImageId), editId: String(row.editId), version: row.version, prompt: row.prompt, model: row.model, createdAt: row.createdAt };
}

export function imageMetadata(value: { preparation?: unknown; lineage?: unknown }) {
  const preparation = safeImagePreparation(value.preparation), lineage = safeImageLineage(value.lineage);
  return { ...(preparation ? { preparation } : {}), ...(lineage ? { lineage } : {}) };
}
