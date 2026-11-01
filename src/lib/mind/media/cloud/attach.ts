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
    const mime = result.mimeType.startsWith("image/") ? result.mimeType : "image/jpeg";
    return {
      ok: true,
      kind: "image",
      image: {
        dataUrl: `data:${mime};base64,${result.base64}`,
        name: result.name,
        mime,
      },
    };
  }
  if (result.kind === "text" && typeof result.text === "string") {
    return { ok: true, kind: "text", staged: { name: result.name, text: result.text } };
  }
  return {
    ok: false,
    error: `“${result.name}” (${result.mimeType}) is not a supported image or text attach from Drive in this lane.`,
  };
}
