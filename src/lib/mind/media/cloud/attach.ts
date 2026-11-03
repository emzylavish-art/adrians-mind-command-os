import { sniffImageMimeFromBase64, sanitizeMediaLabel } from "../harden.ts";
import { normalizeImageDataUrl } from "../data-url.ts";
import type { ImageAttachment } from "../types.ts";
import type { CloudFetchResult } from "./types.ts";

export type StagedTextAttach = { name: string; text: string };

export type CloudAttachPackage =
  | { ok: true; kind: "image"; image: ImageAttachment }
  | { ok: true; kind: "text"; staged: StagedTextAttach }
  | { ok: false; error: string };

/** Map a fetched cloud file into the existing local attach paths (image chips or staged text). */
export function packageCloudFetchForComposer(result: CloudFetchResult): CloudAttachPackage {
  if (!result.ok) return { ok: false, error: result.error };
  if (result.kind === "image") {
    const sniffed = sniffImageMimeFromBase64(result.base64);
    if (!sniffed) {
      return {
        ok: false,
        error: `“${result.name}” did not look like a PNG, JPEG, GIF, or WebP (Content-Type was ${result.mimeType}).`,
      };
    }
    const claimed = (result.mimeType || "").toLowerCase().replace("image/jpg", "image/jpeg");
    if (claimed.startsWith("image/") && claimed !== sniffed && claimed !== "image/jpg") {
      // Allow jpeg/jpg alias only; otherwise treat mismatch as hostile.
      if (!(claimed === "image/jpeg" && sniffed === "image/jpeg")) {
        return {
          ok: false,
          error: `“${result.name}” Content-Type (${result.mimeType}) did not match the file bytes (${sniffed}).`,
        };
      }
    }
    const dataUrl = normalizeImageDataUrl(`data:${sniffed};base64,${result.base64}`);
    if (!dataUrl) {
      return { ok: false, error: `“${result.name}” could not be normalized as an image.` };
    }
    return {
      ok: true,
      kind: "image",
      image: {
        dataUrl,
        name: sanitizeMediaLabel(result.name) || result.name,
        mime: sniffed,
      },
    };
  }
  if (result.kind === "text" && typeof result.text === "string") {
    return { ok: true, kind: "text", staged: { name: sanitizeMediaLabel(result.name) || result.name, text: result.text } };
  }
  return {
    ok: false,
    error: `“${result.name}” (${result.mimeType}) is not a supported image or text attach from Drive in this lane.`,
  };
}
