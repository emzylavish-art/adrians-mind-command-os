/** Shared pure helpers for media UI (no React / DOM). */

export const LIGHTBOX_ZOOM_STEPS = [1, 1.5, 2, 3] as const;

export function nextLightboxZoom(current: number): number {
  const index = LIGHTBOX_ZOOM_STEPS.findIndex((step) => step === current);
  if (index < 0) return LIGHTBOX_ZOOM_STEPS[0];
  return LIGHTBOX_ZOOM_STEPS[(index + 1) % LIGHTBOX_ZOOM_STEPS.length]!;
}

export function prevLightboxZoom(current: number): number {
  const index = LIGHTBOX_ZOOM_STEPS.findIndex((step) => step === current);
  if (index < 0) return LIGHTBOX_ZOOM_STEPS[0];
  return LIGHTBOX_ZOOM_STEPS[(index - 1 + LIGHTBOX_ZOOM_STEPS.length) % LIGHTBOX_ZOOM_STEPS.length]!;
}

/** Apply horizontal mirror to a 2d canvas context before drawImage (WYSIWYG with preview). */
export function applyCameraMirrorTransform(
  ctx: { translate: (x: number, y: number) => void; scale: (x: number, y: number) => void },
  width: number,
  mirror: boolean,
): void {
  if (!mirror) return;
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
}

export function moveAttachmentIndex<T>(items: readonly T[], from: number, direction: -1 | 1): T[] {
  const to = from + direction;
  if (!Number.isInteger(from) || from < 0 || from >= items.length) return [...items];
  if (to < 0 || to >= items.length) return [...items];
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function removeAttachmentIndexes<T>(items: readonly T[], indexes: Iterable<number>): T[] {
  const drop = new Set<number>();
  for (const index of indexes) {
    if (Number.isInteger(index) && index >= 0) drop.add(index);
  }
  if (drop.size === 0) return [...items];
  return items.filter((_, index) => !drop.has(index));
}

export function toggleIndexSelection(selected: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set(selected);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

/**
 * Download filenames must not echo chat/prompt text (data leak via Downloads folder).
 * Only allow short machine-ish stems we mint ourselves; otherwise use a generic stamp.
 */
export function safeImageDownloadName(src: string, label?: string | null): string {
  const ext = src.startsWith("data:image/png")
    ? "png"
    : src.startsWith("data:image/webp")
      ? "webp"
      : src.startsWith("data:image/gif")
        ? "gif"
        : "jpg";
  const raw = typeof label === "string" ? label.trim() : "";
  const stem = raw
    .replace(/\.(png|jpe?g|gif|webp)$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const allowed =
    !!stem &&
    stem.length <= 40 &&
    /^(camera|saved|generated|image|attachment|amcos)([-_.]|$)/i.test(stem) &&
    !/\s/.test(raw);
  const base = allowed ? stem : `amcos-image-${Date.now().toString(36)}`;
  return `${base}.${ext}`;
}
