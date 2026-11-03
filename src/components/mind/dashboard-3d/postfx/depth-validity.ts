import type * as THREE from "three";

/**
 * Scene-depth validity across the EffectComposer ping-pong (light hacker pass).
 *
 * The composer's two render targets each carry a DepthTexture, but only the one
 * RenderPass just drew has real scene depth. Every ShaderPass that writes into
 * a target auto-clears and overwrites that target's depth with the full-screen
 * quad's constant depth. So when god-rays runs first and swaps, focus-depth
 * reads `readBuffer.depthTexture` that holds a FLAT depth: the band weight is
 * the same on every pixel and the whole frame (focused Imagine card included)
 * gets muted, or nothing does.
 *
 * Lane depth consumers mark the target they just wrote with the renderer call
 * counter (`info.render.frame`, bumped by every renderer.render). A consumer
 * whose readBuffer was written by the immediately preceding render call knows
 * that depth is clobbered and falls back to its radial mask. Stale marks never
 * match (the counter has moved on), so the first pass after RenderPass always
 * keeps real depth. Needs no wiring changes.
 */

type RendererLike = { info?: { render?: { frame?: number } } } | null | undefined;
type TargetLike = { depthTexture?: THREE.Texture | null } | null | undefined;
type Mark = { info: object; frame: number };

const marks = new WeakMap<object, Mark>();

function frameOf(renderer: RendererLike): { info: object; frame: number } | null {
  const info = renderer?.info;
  const frame = info?.render?.frame;
  if (!info || typeof frame !== "number" || !Number.isFinite(frame)) return null;
  return { info, frame };
}

/** Call right after a lane ShaderPass rendered into `writeBuffer`. */
export function markDepthClobbered(renderer: RendererLike, writeBuffer: TargetLike): void {
  if (!writeBuffer || typeof writeBuffer !== "object") return;
  const f = frameOf(renderer);
  if (!f) return;
  marks.set(writeBuffer, f);
}

/** True when `target` was overwritten by a lane pass in the immediately preceding render call. */
export function isDepthClobbered(renderer: RendererLike, target: TargetLike): boolean {
  if (!target || typeof target !== "object") return false;
  const m = marks.get(target);
  const f = frameOf(renderer);
  return !!m && !!f && m.info === f.info && m.frame === f.frame;
}

/**
 * Depth texture a consumer may sample for this draw:
 * - readBuffer depth if it still holds scene depth,
 * - null (→ radial fallback) if a lane pass just clobbered it,
 * - the sticky texture only when readBuffer has no depth attachment at all.
 */
export function liveSceneDepth(
  renderer: RendererLike,
  readBuffer: TargetLike,
  sticky: THREE.Texture | null,
): THREE.Texture | null {
  const live = readBuffer?.depthTexture ?? null;
  if (!live) return sticky;
  return isDepthClobbered(renderer, readBuffer) ? null : live;
}
