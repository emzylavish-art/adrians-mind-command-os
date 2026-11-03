/**
 * Shared accept/reject rules for composer attach, paste, and drag-drop.
 * Rejects SVG/HTML disguises and non-raster images before canvas work.
 */

export const MAX_ATTACH_IMAGES = 4;

const BAD_EXT = /\.(svg|html?|xhtml|xml|js|mjs|css|txt|pdf|heic|heif|avif)$/i;
const GOOD_EXT = /\.(png|jpe?g|gif|webp)$/i;

export type ImageFileAccept =
  | { ok: true; file: File }
  | { ok: false; file: File; reason: string };

export function explainRejectedImageFile(file: File): string | null {
  const name = file.name || "file";
  const mime = (file.type || "").toLowerCase();
  if (!file || file.size === 0) return `“${name}” is empty.`;
  if (mime === "image/svg+xml" || /\.svg$/i.test(name)) {
    return `“${name}” is an SVG (not allowed). Convert to PNG or JPEG first.`;
  }
  if (mime.includes("html") || BAD_EXT.test(name) && !GOOD_EXT.test(name)) {
    if (/\.(html?|xhtml|xml)$/i.test(name) || mime.includes("html") || mime.includes("xml")) {
      return `“${name}” looks like HTML/XML, not a raster image.`;
    }
  }
  if (mime.includes("svg")) return `“${name}” is an SVG (not allowed).`;
  if (mime && mime.startsWith("image/") && (mime.includes("heic") || mime.includes("heif") || mime.includes("avif"))) {
    return `“${name}” is HEIC/AVIF (not supported). Convert to JPEG or PNG first.`;
  }
  if (mime && !mime.startsWith("image/") && !GOOD_EXT.test(name)) {
    return `“${name}” is not a PNG/JPEG/GIF/WebP image.`;
  }
  if (!mime && !GOOD_EXT.test(name)) {
    return `“${name}” is not a recognized image file.`;
  }
  // image/* with wrong extension like .html renamed — still allow through to sniff; return null
  if (mime.startsWith("image/") && BAD_EXT.test(name) && !GOOD_EXT.test(name)) {
    return `“${name}” has a suspicious name for an image. Use .png/.jpg/.webp.`;
  }
  return null;
}

export function classifyImageFile(file: File): ImageFileAccept {
  const reason = explainRejectedImageFile(file);
  if (reason) return { ok: false, file, reason };
  return { ok: true, file };
}

export function filterAcceptableImageFiles(
  files: Iterable<File>,
  limit = MAX_ATTACH_IMAGES,
): { accepted: File[]; rejects: string[] } {
  const accepted: File[] = [];
  const rejects: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (accepted.length >= limit) {
      rejects.push(`Only ${limit} images can be attached per message.`);
      break;
    }
    const key = `${file.name}:${file.size}:${file.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const classified = classifyImageFile(file);
    if (!classified.ok) {
      rejects.push(classified.reason);
      continue;
    }
    accepted.push(classified.file);
  }
  return { accepted, rejects };
}

/** Format reject lines for existing composer error text (no banner components). */
export function formatImageRejectNotice(rejects: string[], acceptedCount: number): string {
  const head = rejects.slice(0, 3).join(" ");
  const more = rejects.length > 3 ? ` (+${rejects.length - 3} more rejected)` : "";
  if (acceptedCount > 0) return `Attached ${acceptedCount}. Rejected: ${head}${more}`;
  return head + more;
}
