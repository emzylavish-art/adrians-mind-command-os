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

/** Camera burst: take this many frames in one auto-burst action (inclusive range). */
export const BURST_MIN = 3;
export const BURST_MAX = 5;
/** Absolute candidate tray size (cannot exceed BURST_MAX). */
export const BURST_CANDIDATE_CAP = BURST_MAX;
/** Soft total data-URL char budget for one Attach-selected action. */
export const BURST_ATTACH_CHAR_BUDGET = 4_500_000;

export type BurstCandidate = { id: string; dataUrl: string; name: string };

export function clampBurstCount(requested: number): number {
  if (!Number.isFinite(requested)) return BURST_MIN;
  return Math.min(BURST_MAX, Math.max(BURST_MIN, Math.floor(requested)));
}

/** Pick selected candidates without exceeding slot/char budgets. */
export function selectBurstAttachments(
  candidates: readonly BurstCandidate[],
  selectedIds: ReadonlySet<string>,
  options: { remainingSlots: number; charBudget?: number } = { remainingSlots: 4 },
): { ok: true; items: BurstCandidate[] } | { ok: false; error: string } {
  const budget = options.charBudget ?? BURST_ATTACH_CHAR_BUDGET;
  const slots = Math.max(0, Math.floor(options.remainingSlots));
  if (slots <= 0) return { ok: false, error: "Composer already has 4 images. Remove one before attaching a burst." };
  const picked: BurstCandidate[] = [];
  let chars = 0;
  for (const candidate of candidates) {
    if (!selectedIds.has(candidate.id)) continue;
    if (picked.length >= slots) break;
    const next = chars + candidate.dataUrl.length;
    if (next > budget) {
      if (picked.length === 0) {
        return { ok: false, error: "That burst frame is too large to attach after compression." };
      }
      break;
    }
    picked.push(candidate);
    chars = next;
  }
  if (picked.length === 0) return { ok: false, error: "Select at least one burst frame to attach." };
  return { ok: true, items: picked };
}

/** Counter-based dragover so child enter/leave does not flicker `data-drag="over"`. */
export type ComposerDragOverState = { depth: number };

export function createComposerDragOverState(): ComposerDragOverState {
  return { depth: 0 };
}

/** @returns true when the zone newly becomes "over" (depth 0 → 1). */
export function composerDragEnter(state: ComposerDragOverState): boolean {
  state.depth += 1;
  return state.depth === 1;
}

/** @returns true when the zone newly leaves "over" (depth 1 → 0). */
export function composerDragLeave(state: ComposerDragOverState): boolean {
  state.depth = Math.max(0, state.depth - 1);
  return state.depth === 0;
}

export function composerDragReset(state: ComposerDragOverState): void {
  state.depth = 0;
}

export function composerDragIsOver(state: ComposerDragOverState): boolean {
  return state.depth > 0;
}
