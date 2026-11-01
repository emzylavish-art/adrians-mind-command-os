import { useState } from "react";

export function InlineImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="my-2 block max-w-full overflow-hidden rounded-panel border border-line" onClick={() => setOpen(true)} aria-label={`Enlarge ${alt}`}>
        <img src={src} alt={alt} className="max-h-64 max-w-full object-contain" />
      </button>
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
