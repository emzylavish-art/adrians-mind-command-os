import { useState } from "react";
import { isSafeImageSrc, sanitizeMediaLabel } from "@/lib/mind/media";

export const AMCOS_IMAGE_DRAG_TYPE = "application/x-amcos-image";

export function InlineImage({
  src,
  alt,
  onEditImagine,
  onSave,
  onDownload,
  onUseAsAgentInput,
}: {
  src: string;
  alt: string;
  onEditImagine?: (src: string) => void;
  onSave?: (src: string, alt: string) => void;
  onDownload?: (src: string, alt: string) => void;
  onUseAsAgentInput?: (src: string, alt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const safeSrc = isSafeImageSrc(src) ? src : null;
  const safeAlt = sanitizeMediaLabel(alt) || "image";
  if (!safeSrc) {
    return <p className="my-2 text-xs text-muted">Blocked unsafe image source.</p>;
  }
  return (
    <>
      <div className="my-2 space-y-2">
        <button
          type="button"
          className="block max-w-full overflow-hidden rounded-panel border border-line"
          onClick={() => setOpen(true)}
          aria-label={`Enlarge ${safeAlt}`}
          draggable={safeSrc.startsWith("data:image/")}
          onDragStart={(event) => {
            if (!safeSrc.startsWith("data:image/")) return;
            event.dataTransfer.setData(AMCOS_IMAGE_DRAG_TYPE, JSON.stringify({ dataUrl: safeSrc, name: safeAlt }));
            event.dataTransfer.setData("text/plain", safeAlt);
            event.dataTransfer.effectAllowed = "copy";
          }}
        >
          <img src={safeSrc} alt={safeAlt} className="max-h-64 max-w-full object-contain" loading="lazy" decoding="async" draggable={false} />
        </button>
        <div className="flex flex-wrap gap-2">
          {onEditImagine && (
            <button type="button" data-testid="imagine-edit" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => onEditImagine(safeSrc)}>
              Edit with Imagine
            </button>
          )}
          {onUseAsAgentInput && safeSrc.startsWith("data:image/") && (
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => onUseAsAgentInput(safeSrc, safeAlt)}>
              Use as Agent input
            </button>
          )}
          {onSave && (
            <button type="button" data-testid="image-save" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => onSave(safeSrc, safeAlt)}>
              Save
            </button>
          )}
          {onDownload && (
            <button type="button" data-testid="image-download" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => onDownload(safeSrc, safeAlt)}>
              Download
            </button>
          )}
        </div>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={safeAlt}
          onClick={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <img src={safeSrc} alt={safeAlt} className="max-h-[90vh] max-w-[90vw] object-contain" loading="lazy" decoding="async" />
        </div>
      )}
    </>
  );
}
