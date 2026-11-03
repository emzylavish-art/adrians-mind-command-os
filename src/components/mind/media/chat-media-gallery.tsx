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

  if (items.length === 0) return null;

  return (
    <section className="mb-3 rounded-panel border border-line bg-surface p-3" data-media="chat-gallery" aria-label="Chat media gallery">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Chat images · {items.length}
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4" data-media="chat-gallery-grid">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="overflow-hidden rounded-panel border border-line bg-bg"
              data-media="chat-gallery-thumb"
              data-kind={item.kind}
              aria-label={`Open ${item.name}`}
              onClick={() => setActive(item)}
            >
              <img src={item.src} alt={item.name} className="aspect-square w-full object-cover" draggable={false} />
              <span className="block truncate px-2 py-1 text-[10px] text-muted">{item.kind} · {item.name}</span>
            </button>
          ))}
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
