import { useRef } from "react";
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
  const viewer = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
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
          ref={trigger}
          onClick={() => viewer.current?.showModal()}
          aria-label={`Enlarge ${safeAlt}`}
          draggable={safeSrc.startsWith("data:image/")}
          onDragStart={(event) => {
            if (!safeSrc.startsWith("data:image/")) return;
            event.dataTransfer.setData(AMCOS_IMAGE_DRAG_TYPE, JSON.stringify({ dataUrl: safeSrc, name: safeAlt }));
            event.dataTransfer.setData("text/plain", safeAlt);
            event.dataTransfer.effectAllowed = "copy";
          }}
        >
          <img src={safeSrc} alt={safeAlt} className="max-h-64 max-w-full object-contain" draggable={false} />
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
      <dialog ref={viewer} aria-label={safeAlt} className="fixed inset-0 m-auto max-h-[94dvh] max-w-[94vw] rounded-panel bg-surface p-3 text-fg backdrop:bg-black/80"
        onClose={() => trigger.current?.focus()}>
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 break-words text-sm">{safeAlt}</span>
          <button type="button" className="min-h-11 shrink-0 rounded-panel border border-line px-3 text-sm" onClick={() => viewer.current?.close()}>Close image</button>
        </div>
        <img src={safeSrc} alt={safeAlt} className="max-h-[76dvh] w-full max-w-[88vw] object-contain" loading="lazy" />
      </dialog>
    </>
  );
}
