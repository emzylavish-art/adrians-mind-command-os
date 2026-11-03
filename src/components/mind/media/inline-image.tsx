import { useEffect, useState } from "react";
import { isSafeImageSrc, sanitizeMediaLabel } from "@/lib/mind/media";
import { nextLightboxZoom, prevLightboxZoom, safeImageDownloadName } from "./media-ui-helpers";

export const AMCOS_IMAGE_DRAG_TYPE = "application/x-amcos-image";
export { nextLightboxZoom, prevLightboxZoom, safeImageDownloadName } from "./media-ui-helpers";

function downloadFallback(src: string, label?: string | null) {
  const link = document.createElement("a");
  link.href = src;
  link.download = safeImageDownloadName(src, label);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

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
  const [zoom, setZoom] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const safeSrc = isSafeImageSrc(src) ? src : null;
  const safeAlt = sanitizeMediaLabel(alt) || "image";

  useEffect(() => {
    if (!open) setZoom(1);
  }, [open]);

  useEffect(() => {
    setLoading(true);
  }, [safeSrc]);

  if (!safeSrc) {
    return <p className="my-2 text-xs text-muted">Blocked unsafe image source.</p>;
  }

  function handleDownload() {
    // Pass a machine-safe label only — never raw chat/prompt text as a Downloads filename.
    const safeLabel = /^(camera|saved|generated|image|attachment|amcos)/i.test(safeAlt) ? safeAlt : null;
    if (onDownload) onDownload(safeSrc!, safeLabel || "amcos-image");
    else downloadFallback(safeSrc!, safeLabel);
  }

  return (
    <>
      <div className="my-2 space-y-2" data-media="inline-image" data-loading={loading ? "true" : "false"}>
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
          <img
            src={safeSrc}
            alt={safeAlt}
            className="max-h-64 max-w-full object-contain"
            draggable={false}
            onLoad={() => setLoading(false)}
            onError={() => setLoading(false)}
          />
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
            <button
              type="button"
              data-testid="image-save"
              data-media="use-in-composer"
              className="min-h-11 rounded-panel border border-line px-3 text-xs"
              title="Re-attach into the composer (re-encoded, EXIF stripped) for vision or Imagine edit"
              onClick={() => onSave(safeSrc, safeAlt)}
            >
              Use in composer
            </button>
          )}
          {onDownload && (
            <button type="button" data-testid="image-download" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={handleDownload}>
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
          data-testid="image-lightbox"
          data-media="lightbox"
          onClick={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "+" || event.key === "=") {
              event.preventDefault();
              setZoom((current) => nextLightboxZoom(current));
            }
            if (event.key === "-") {
              event.preventDefault();
              setZoom((current) => prevLightboxZoom(current));
            }
          }}
        >
          <div
            className="flex max-h-[95vh] w-full max-w-[95vw] flex-col items-center gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="overflow-auto rounded-panel border border-line bg-black/40 p-2">
              <img
                src={safeSrc}
                alt={safeAlt}
                data-testid="image-lightbox-img"
                style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
                className="max-h-[75vh] max-w-[90vw] object-contain transition-transform"
              />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                data-testid="image-lightbox-zoom-out"
                data-media="lightbox-zoom-out"
                className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm"
                onClick={() => setZoom((current) => prevLightboxZoom(current))}
                title="Zoom out"
              >
                Zoom out
              </button>
              <span className="min-w-16 text-center text-sm text-white" aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                data-testid="image-lightbox-zoom-in"
                data-media="lightbox-zoom-in"
                className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm"
                onClick={() => setZoom((current) => nextLightboxZoom(current))}
                title="Zoom in"
              >
                Zoom in
              </button>
              <button
                type="button"
                data-testid="image-lightbox-download"
                data-media="lightbox-download"
                className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm"
                onClick={handleDownload}
                title="Download image"
              >
                Download
              </button>
              <button
                type="button"
                data-testid="image-lightbox-close"
                data-media="lightbox-close"
                className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
