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
  if (images.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attached images">
      {images.map((image, index) => (
        <li key={`${image.name ?? "image"}-${index}`} className="relative inline-flex items-center gap-2 rounded-panel border border-line bg-bg p-1 pr-2 text-xs">
          <button
            type="button"
            className="block overflow-hidden rounded-panel"
            aria-label={image.name ? `Attached ${image.name}` : `Attached image ${index + 1}`}
          >
            {isSafeImageSrc(image.dataUrl) ? (
              <img src={image.dataUrl} alt={sanitizeMediaLabel(image.name) || `Attachment ${index + 1}`} className="size-12 object-cover" />
            ) : (
              <span className="text-[10px] text-muted">blocked</span>
            )}
          </button>
          <span className="max-w-24 truncate text-muted">{sanitizeMediaLabel(image.name) || `Image ${index + 1}`}</span>
          {onEditImagine && (
            <button
              type="button"
              className="min-h-11 px-2 text-accent"
              onClick={() => onEditImagine(image, index)}
              aria-label={`Edit ${image.name || `image ${index + 1}`} with Imagine`}
            >
              Edit
            </button>
          )}
          <button type="button" className="min-h-11 px-2 text-danger" onClick={() => onRemove(index)} aria-label={`Remove ${image.name || `image ${index + 1}`}`}>
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
