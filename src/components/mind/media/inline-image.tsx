import { useState } from "react";

export function InlineImage({
  src,
  alt,
  onEditImagine,
  onSave,
  onDownload,
}: {
  src: string;
  alt: string;
  onEditImagine?: (src: string) => void;
  onSave?: (src: string, alt: string) => void;
  onDownload?: (src: string, alt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="my-2 space-y-2">
        <button type="button" className="block max-w-full overflow-hidden rounded-panel border border-line" onClick={() => setOpen(true)} aria-label={`Enlarge ${alt}`}>
          <img src={src} alt={alt} className="max-h-64 max-w-full object-contain" />
        </button>
        <div className="flex flex-wrap gap-2">
          {onEditImagine && (
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => onEditImagine(src)}>
              Edit with Imagine
            </button>
          )}
          {onSave && (
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => onSave(src, alt)}>
              Save
            </button>
          )}
          {onDownload && (
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => onDownload(src, alt)}>
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
          aria-label={alt}
          onClick={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <img src={src} alt={alt} className="max-h-[90vh] max-w-[90vw] object-contain" />
        </div>
      )}
    </>
  );
}
