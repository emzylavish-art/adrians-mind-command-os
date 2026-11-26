import type { VideoJobStore } from "./video-jobs.ts";
import { fetchPinnedUrl } from "./ssrf.ts";

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export async function downloadOwnedVideo(ownerId: string, operationId: string, store: VideoJobStore, download: typeof fetchPinnedUrl = fetchPinnedUrl): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; error: string; status: number }> {
  const job = await store.get(ownerId, operationId);
  if (!job || job.ownerId !== ownerId || job.state !== "completed" || !job.url) return { ok: false, error: "A completed generation for this account is required.", status: 404 };
  if (job.temporary) return { ok: false, error: "Permanent device copies are disabled for this temporary generation.", status: 403 };
  // The URL comes only from this owner's saved provider receipt, never from the
  // caller. DNS pinning, private-address refusal, no redirects and size caps apply.
  const result = await download(job.url, { maxBytes: MAX_VIDEO_BYTES });
  if (!result.ok) return { ok: false, error: "The provider video could not be downloaded. Its temporary link may have expired; no permanent copy was saved.", status: 502 };
  const bytes = new Uint8Array(result.bytes);
  const mp4 = bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  const webm = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (!mp4 && !webm) return { ok: false, error: "The result is not a supported MP4 or WebM video. Nothing was saved.", status: 415 };
  return { ok: true, bytes, mime: mp4 ? "video/mp4" : "video/webm" };
}
