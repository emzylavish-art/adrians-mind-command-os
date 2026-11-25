import { useMemo, useState } from "react";
import { listChatGalleryImages, type ChatGalleryItem, type GalleryMessage } from "@/lib/mind/media/chat-gallery";
import { InlineImage } from "./inline-image";

export function ChatMediaGallery({
  messages,
  onUseInComposer,
  onEditImagine,
  onDownload,
}: {
  messages: GalleryMessage[] | undefined | null;
  onUseInComposer?: (src: string, alt: string) => void;
  onEditImagine?: (src: string) => void;
  onDownload?: (src: string, alt: string) => void;
}) {
  const items = useMemo(() => listChatGalleryImages(messages), [messages]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ChatGalleryItem | null>(null);
  const kinds = ["attached", "camera", "generated", "edited"] as const;

  const unavailable = (messages ?? []).flatMap((msg) => (msg.images ?? []).filter(img => !img.dataUrl && img.blobId));
  if (!items.length && !unavailable.length) return null;

  return (
    <section className="mb-3 rounded-panel border border-line bg-surface p-3" data-media="chat-gallery" aria-label="Chat media gallery">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Chat images · {items.length + unavailable.length}
        </p>
        <button
          type="button"
          className="min-h-11 rounded-panel border border-line px-3 text-xs"
          data-media="chat-gallery-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide gallery" : "Show gallery"}
        </button>
      </div>
      {open && (
        <div className="space-y-3" data-media="chat-gallery-grid">
          {unavailable.map((image, i) => <p key={i} className="text-sm text-muted">{image.name || "Saved image"} · Image data unavailable on this device</p>)}
          {kinds.map((kind) => {
            const group = items.filter((item) => item.kind === kind);
            return (
              <div key={kind}>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted">{kind} · {group.length}</p>
                {group.length === 0 ? <p className="text-xs text-muted">None in this chat.</p> : (
                  <div className="flex flex-wrap gap-2">
                    {group.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className="w-24 overflow-hidden rounded-panel border border-line bg-bg"
                        data-media="chat-gallery-thumb"
                        data-kind={item.kind}
                        aria-label={`Open ${item.name}`}
                        onClick={() => setActive(item)}
                      >
                        <img src={item.src} alt={item.name} className="aspect-square w-full object-cover" draggable={false} />
                        <span className="block truncate px-2 py-1 text-[10px] text-muted">{item.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {active && (
        <div className="mt-3" data-media="chat-gallery-lightbox">
          <InlineImage
            src={active.src}
            alt={active.name}
            onEditImagine={onEditImagine}
            onSave={onUseInComposer}
            onDownload={onDownload}
          />
          <button
            type="button"
            className="mt-2 min-h-11 rounded-panel border border-line px-3 text-xs"
            data-media="chat-gallery-close"
            onClick={() => setActive(null)}
          >
            Close preview
          </button>
        </div>
      )}
    </section>
  );
}
