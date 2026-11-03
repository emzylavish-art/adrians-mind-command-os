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
