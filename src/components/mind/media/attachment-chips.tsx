import { useEffect, useState } from "react";
import { isSafeImageSrc, sanitizeMediaLabel, type ImageAttachment } from "@/lib/mind/media";

export function AttachmentChips({
  images,
  onRemove,
  onEditImagine,
}: {
  images: ImageAttachment[];
  onRemove: (index: number) => void;
  onEditImagine?: (image: ImageAttachment, index: number) => void;
}) {
  const [preview, setPreview] = useState<ImageAttachment | null>(null);

  useEffect(() => {
    if (!preview) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPreview(null);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [preview]);

  if (images.length === 0) return null;

  return (
    <>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attached images">
        {images.map((image, index) => (
          <li key={String(image.name ?? "image") + "-" + index} className="relative inline-flex items-center gap-2 rounded-panel border border-line bg-bg p-1 pr-2 text-xs">
            <button
              type="button"
              className="block overflow-hidden rounded-panel disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={image.name ? "Preview attached " + sanitizeMediaLabel(image.name) : "Preview attached image " + (index + 1)}
              disabled={!isSafeImageSrc(image.dataUrl)}
              onClick={() => setPreview(image)}
            >
              {isSafeImageSrc(image.dataUrl) ? (
                <img src={image.dataUrl} alt={sanitizeMediaLabel(image.name) || "Attachment " + (index + 1)} className="size-12 object-cover" />
              ) : (
                <span className="text-[10px] text-muted">blocked</span>
              )}
            </button>
            <span className="max-w-24 truncate text-muted">{sanitizeMediaLabel(image.name) || "Image " + (index + 1)}</span>
            {onEditImagine && (
              <button
                type="button"
                className="min-h-11 px-2 text-accent"
                onClick={() => onEditImagine(image, index)}
                aria-label={"Edit " + (sanitizeMediaLabel(image.name) || "image " + (index + 1)) + " with Imagine"}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className="min-h-11 px-2 text-danger"
              onClick={() => onRemove(index)}
              aria-label={"Remove " + (sanitizeMediaLabel(image.name) || "image " + (index + 1))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {preview && isSafeImageSrc(preview.dataUrl) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={"Image preview: " + (sanitizeMediaLabel(preview.name) || "attached image")}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4"
        >
          <div className="flex max-h-[90vh] max-w-[90vw] flex-col gap-3 rounded-panel border border-line bg-surface p-3 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <p className="truncate text-sm text-muted">{sanitizeMediaLabel(preview.name) || "Image preview"}</p>
              <button
                type="button"
                autoFocus
                className="min-h-11 rounded-panel border border-line px-4 text-sm"
                onClick={() => setPreview(null)}
                aria-label="Close image preview"
              >
                Close
              </button>
            </div>
            <img
              src={preview.dataUrl}
              alt={sanitizeMediaLabel(preview.name) || "Attached image"}
              className="max-h-[70vh] max-w-[85vw] object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
