/**
 * Path-traversal-safe remote filenames. No user-supplied upload URLs (SSRF-safe by design).
 */

const MAX_NAME = 180;

export function sanitizeStorageFileName(raw: unknown): string {
  if (typeof raw !== "string") return "media.bin";
  let name = raw.replace(/\\/g, "/").split("/").pop() ?? "media.bin";
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\.\./g, "").trim();
  name = name.replace(/[<>:`"'|?*]/g, "_");
  if (!name || name === "." || name === "..") name = "media.bin";
  if (name.length > MAX_NAME) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && dot > name.length - 12 ? name.slice(dot) : "";
    name = name.slice(0, MAX_NAME - ext.length) + ext;
  }
  return name;
}

export function sanitizeFolderSegments(segments: unknown): string[] {
  if (!Array.isArray(segments)) return [];
  const out: string[] = [];
  for (const seg of segments) {
    if (typeof seg !== "string") continue;
    // eslint-disable-next-line no-control-regex
    const cleaned = seg
      .replace(/\\/g, "/")
      .split("/")
      .map((p) => {
        // eslint-disable-next-line no-control-regex
        return p.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\.\./g, "").trim();
      })
      .filter((p) => p && p !== "." && p !== "..");
    for (const p of cleaned) {
      if (/^[A-Za-z0-9._\- ]{1,64}$/.test(p)) out.push(p);
    }
  }
  return out.slice(0, 8);
}

export function sniffMime(bytes: Uint8Array, fallback = "application/octet-stream"): string {
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return "application/octet-stream";
  if (bytes.length >= 4) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  }
  return fallback;
}

/** A .png name is not an image when the bytes are a Windows executable. */
export function rejectDisguisedExecutable(fileName: string, bytes: Uint8Array): boolean {
  const claimedImage = /\.(png|jpe?g|gif|webp)$/i.test(fileName);
  const executable = bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
  return claimedImage && executable;
}
