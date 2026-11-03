import { useState } from "react";
import { isSafeImageSrc, sanitizeMediaLabel, type ImageAttachment } from "@/lib/mind/media";
import { moveAttachmentIndex, removeAttachmentIndexes, toggleIndexSelection } from "./media-ui-helpers";

const CHIP_DRAG_TYPE = "application/x-amcos-chip-index";

export function AttachmentChips({
  images,
  onChange,
  onRemove,
  onEditImagine,
}: {
  images: ImageAttachment[];
  /** Preferred: replace the full list after reorder / multi-remove. */
  onChange?: (next: ImageAttachment[]) => void;
  /** Legacy single-remove; used when onChange is absent. */
  onRemove?: (index: number) => void;
  onEditImagine?: (image: ImageAttachment, index: number) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  if (images.length === 0) return null;

  function commit(next: ImageAttachment[]) {
    if (onChange) onChange(next);
  }

  function move(index: number, direction: -1 | 1) {
    const next = moveAttachmentIndex(images, index, direction);
    if (next === images || next.every((item, i) => item === images[i])) return;
    commit(next);
    setSelected((prev) => {
      const mapped = new Set<number>();
      for (const sel of prev) {
        if (sel === index) mapped.add(index + direction);
        else if (sel === index + direction) mapped.add(index);
        else mapped.add(sel);
      }
      return mapped;
    });
  }

  function removeOne(index: number) {
    if (onChange) {
      commit(removeAttachmentIndexes(images, [index]));
    } else {
      onRemove?.(index);
    }
    setSelected((prev) => {
      const next = new Set<number>();
      for (const sel of prev) {
        if (sel === index) continue;
        next.add(sel > index ? sel - 1 : sel);
      }
      return next;
    });
  }

  function removeSelected() {
    if (selected.size === 0) return;
    if (onChange) {
      commit(removeAttachmentIndexes(images, selected));
    } else {
      const ordered = [...selected].sort((a, b) => b - a);
      for (const index of ordered) onRemove?.(index);
    }
    setSelected(new Set());
  }

  function onDropReorder(toIndex: number) {
    if (dragFrom === null || dragFrom === toIndex) {
      setDragFrom(null);
      return;
    }
    const direction = toIndex > dragFrom ? 1 : -1;
    let next = images.slice();
    let from = dragFrom;
    while (from !== toIndex) {
      next = moveAttachmentIndex(next, from, direction);
      from += direction;
    }
    commit(next);
    setSelected(new Set([toIndex]));
    setDragFrom(null);
  }

  return (
    <div className="mt-2 space-y-2" data-media="attachment-chips-tray">
      {selected.size > 0 && (
        <div className="flex flex-wrap gap-2" data-media="attachment-chips-bulk">
          <button
            type="button"
            className="min-h-11 rounded-panel border border-line px-3 text-xs text-danger"
            data-media="attachment-chips-remove-selected"
            onClick={removeSelected}
          >
            Remove selected ({selected.size})
          </button>
          <button
            type="button"
            className="min-h-11 rounded-panel border border-line px-3 text-xs"
            data-media="attachment-chips-clear-selection"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}
      <ul className="flex flex-wrap gap-2" aria-label="Attached images" data-media="attachment-chips">
        {images.map((image, index) => {
          const isSelected = selected.has(index);
          const label = sanitizeMediaLabel(image.name) || `Image ${index + 1}`;
          return (
            <li
              key={`${image.name ?? "image"}-${index}`}
              className={`relative inline-flex items-center gap-2 rounded-panel border border-line bg-bg p-1 pr-2 text-xs ${isSelected ? "ring-2 ring-accent" : ""}`}
              data-media="attachment-chip"
              data-selected={isSelected ? "true" : "false"}
              draggable
              onDragStart={(event) => {
                setDragFrom(index);
                event.dataTransfer.setData(CHIP_DRAG_TYPE, String(index));
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                const raw = event.dataTransfer.getData(CHIP_DRAG_TYPE);
                const from = Number.parseInt(raw || String(dragFrom ?? ""), 10);
                if (!Number.isFinite(from)) return;
                setDragFrom(from);
                onDropReorder(index);
              }}
              onDragEnd={() => setDragFrom(null)}
            >
              <input
                type="checkbox"
                className="size-4"
                checked={isSelected}
                data-media="attachment-chip-select"
                aria-label={`Select ${label}`}
                onChange={() => setSelected((prev) => toggleIndexSelection(prev, index))}
              />
              <button
                type="button"
                className="block overflow-hidden rounded-panel"
                aria-label={image.name ? `Attached ${image.name}` : `Attached image ${index + 1}`}
                data-media="attachment-chip-thumb"
              >
                {isSafeImageSrc(image.dataUrl) ? (
                  <img src={image.dataUrl} alt={label} className="size-12 object-cover" draggable={false} />
                ) : (
                  <span className="text-[10px] text-muted">blocked</span>
                )}
              </button>
              <span className="max-w-24 truncate text-muted">{label}</span>
              <button
                type="button"
                className="min-h-11 px-2"
                data-media="attachment-chip-move-left"
                aria-label={`Move ${label} left`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ←
              </button>
              <button
                type="button"
                className="min-h-11 px-2"
                data-media="attachment-chip-move-right"
                aria-label={`Move ${label} right`}
                disabled={index >= images.length - 1}
                onClick={() => move(index, 1)}
              >
                →
              </button>
              {onEditImagine && (
                <button
                  type="button"
                  className="min-h-11 px-2 text-accent"
                  data-media="attachment-chip-edit"
                  onClick={() => onEditImagine(image, index)}
                  aria-label={`Edit ${label} with Imagine`}
                >
                  Edit
                </button>
              )}
              <button
                type="button"
                className="min-h-11 px-2 text-danger"
                data-media="attachment-chip-remove"
                onClick={() => removeOne(index)}
                aria-label={`Remove ${label}`}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
