import * as THREE from "three";
import { relativeLuminance } from "./wcag-contrast.ts";
import type { UvRect } from "./detail-backdrop-dim.ts";

/**
 * Measured backdrop luminance (light lane, queue #68; builds on #67 dim).
 *
 * Every METER_INTERVAL_MS the dim pass downsamples the composer buffer UNDER
 * each card/chart rect (the dim pass's own input — never its output, so the
 * measurement can't feed back on itself) into a tiny METER_EDGE×METER_EDGE
 * RGBA8 target (16 taps per texel) and reads it back asynchronously. The
 * worst-case (p90) relative luminance drives the dim so text reaches WCAG.
 *
 * Honesty: no read yet / read failed / rects changed / result older than
 * METER_MAX_AGE_MS → `measurement` is null and the caller keeps the static #67
 * dim. Failures are surfaced on `lastError`, never swallowed. Hidden tab → no
 * reads. Reduced motion → exactly one read per rect layout (static).
 */

export const METER_INTERVAL_MS = 500;
export const METER_MAX_AGE_MS = 2000;
export const METER_EDGE = 8;
/** Bright-tail percentile used as the worst case under text. */
export const METER_PERCENTILE = 0.9;
/** #80: a readback (begin→resolve) slower than this (≈2 frames) doubles the interval. */
export const METER_SLOW_READ_MS = 33;
/** #80: a readback at or under this (≈1 frame) halves the back-off again. */
export const METER_FAST_READ_MS = 17;
/** #80: a frame this long while a read is in flight counts as a drop caused by it. */
export const METER_DROP_FRAME_MS = 50;
/** #80: interval never widens past METER_INTERVAL_MS × this. */
export const METER_MAX_BACKOFF = 8;

export type MeterBackoffReason = "slow-readback" | "frame-drop" | "readback-timeout" | null;
export type MeterBackoff = {
  /** 1 = nominal; doubles per slow read up to METER_MAX_BACKOFF. */
  multiplier: number;
  /** Effective sampling interval right now (base × multiplier). */
  intervalMs: number;
  /** Real begin→resolve time of the last completed read, or null if none yet. */
  lastLatencyMs: number | null;
  /** Why the current back-off exists (null when nominal). */
  reason: MeterBackoffReason;
};

export type LuminanceStats = { mean: number; p90: number; max: number; samples: number };

/**
 * Relative-luminance stats of an RGBA8 (or 0..1 float) block. Alpha ignored
 * (composer alpha is not coverage). Junk / empty → null.
 */
export function measureLuminance(
  data: ArrayLike<number> | null | undefined,
  width: number,
  height: number,
  opts: { normalized?: boolean } = {},
): LuminanceStats | null {
  if (!data || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const n = width * height;
  if (data.length < n * 4) return null;
  const scale = opts.normalized ? 1 : 1 / 255;
  const lums: number[] = [];
  for (let i = 0; i < n; i++) {
    const l = relativeLuminance([data[i * 4]! * scale, data[i * 4 + 1]! * scale, data[i * 4 + 2]! * scale]);
    if (l !== null) lums.push(l);
  }
  if (!lums.length) return null;
  lums.sort((a, b) => a - b);
  const mean = lums.reduce((s, v) => s + v, 0) / lums.length;
  const p90 = lums[Math.min(lums.length - 1, Math.floor(METER_PERCENTILE * (lums.length - 1) + 0.5))]!;
  return { mean, p90, max: lums[lums.length - 1]!, samples: lums.length };
}

/** Stable key for a rect layout (rounded so sub-pixel scroll jitter doesn't re-key). */
export function rectsKey(rects: readonly UvRect[]): string {
  return rects.map((r) => r.map((v) => Math.round(v * 400)).join(",")).join("|");
}

export type MeterMeasurement = { stats: LuminanceStats; perRect: LuminanceStats[]; atMs: number; key: string };

export type BackdropMeter = {
  /** Should the pass sample this frame? */
  due: (nowMs: number, key: string, opts?: { hidden?: boolean; reducedMotion?: boolean }) => boolean;
  /** Start a read for `key`; returns a token for resolve/fail. */
  begin: (nowMs: number, key: string) => number;
  resolve: (token: number, perRect: (LuminanceStats | null)[], nowMs: number) => void;
  fail: (token: number, error: unknown) => void;
  /** Fresh measurement for `key` or null (stale / other layout / none). */
  measurementFor: (key: string, nowMs: number) => MeterMeasurement | null;
  /**
   * #84: the latest measurement if still fresh, whatever layout key it was
   * read for (caller checks which slots of its key still apply). Null when
   * none / stale / clock skew.
   */
  latestFresh: (nowMs: number) => MeterMeasurement | null;
  readonly inFlight: boolean;
  readonly lastError: string | null;
  readonly reads: number;
  /** #80: report a frame duration so drops during an in-flight read widen the interval. */
  noteFrame: (dtMs: number) => void;
  /** #80: honest back-off state (real timings only). */
  readonly backoff: MeterBackoff;
  /**
   * Hacker pass (cycle after #80): the page stopped rendering (tab hidden,
   * context lost) while a read was in flight. That read's latency / resume
   * frame / timeout are NOT readback cost: it settles without touching the
   * back-off and is surfaced as lastError "readback-suspended". No-op when idle.
   */
  suspend: () => void;
  reset: () => void;
};

export function createBackdropMeter(opts: { intervalMs?: number; maxAgeMs?: number } = {}): BackdropMeter {
  const interval = Number.isFinite(opts.intervalMs) && opts.intervalMs! > 0 ? opts.intervalMs! : METER_INTERVAL_MS;
  const maxAge = Number.isFinite(opts.maxAgeMs) && opts.maxAgeMs! > 0 ? opts.maxAgeMs! : METER_MAX_AGE_MS;
  let token = 0;
  let pending: { token: number; key: string; atMs: number; suspended?: boolean } | null = null;
  let lastStart = -Infinity;
  let lastKey = "";
  let latest: MeterMeasurement | null = null;
  let lastError: string | null = null;
  let reads = 0;
  let mult = 1;
  let reason: MeterBackoffReason = null;
  let lastLatency: number | null = null;
  let droppedDuringRead = false;
  const widen = (why: Exclude<MeterBackoffReason, null>) => {
    mult = Math.min(METER_MAX_BACKOFF, mult * 2);
    reason = why;
  };
  /** Record a completed read's real latency and adjust the back-off. */
  const settle = (latency: number) => {
    lastLatency = latency;
    if (droppedDuringRead) widen("frame-drop");
    else if (latency > METER_SLOW_READ_MS) widen("slow-readback");
    else if (latency <= METER_FAST_READ_MS && mult > 1) {
      mult = Math.max(1, mult / 2);
      if (mult === 1) reason = null;
    }
    droppedDuringRead = false;
  };
  return {
    due(nowMs, key, o = {}) {
      if (!Number.isFinite(nowMs) || !key || o.hidden) return false;
      if (pending) {
        // A readback that never resolves (lost context, driver stall) must not
        // wedge the meter forever: time it out, surface it, allow a new read.
        if (nowMs - pending.atMs <= maxAge) return false;
        const excused = !!pending.suspended;
        pending = null;
        droppedDuringRead = false;
        if (excused) lastError = "readback-suspended";
        else {
          lastError = "readback-timeout";
          widen("readback-timeout");
        }
      }
      if (key !== lastKey) return true;
      if (o.reducedMotion) return !latest || latest.key !== key; // one read per layout
      // Clock went backwards (mixed clocks / injected now): re-arm instead of
      // waiting out a negative gap forever.
      if (nowMs < lastStart) return true;
      return nowMs - lastStart >= interval * mult;
    },
    begin(nowMs, key) {
      token += 1;
      pending = { token, key, atMs: nowMs };
      droppedDuringRead = false;
      lastStart = nowMs;
      lastKey = key;
      reads += 1;
      return token;
    },
    resolve(t, perRect, nowMs) {
      if (!pending || pending.token !== t) return; // superseded / reset
      const { key, atMs: sampledAt, suspended } = pending;
      pending = null;
      if (suspended) {
        // Hidden-tab / lost-context time is not GPU cost; the sampled frame is
        // from before the gap, so it is never used as a fresh reading either.
        droppedDuringRead = false;
        lastError = "readback-suspended";
        return;
      }
      if (Number.isFinite(nowMs) && nowMs >= sampledAt) settle(nowMs - sampledAt);
      // Age is measured from the frame that was SAMPLED, not when the async
      // readback landed: a 1.9 s driver stall must not make a 1.9 s-old backdrop
      // count as fresh for another METER_MAX_AGE_MS (hacker pass, cycle after #68).
      // Hacker pass (cycle after #79): nowMs < sampledAt (clock skew) gave a
      // negative age that counted as fresh; treat it as unusable, surfaced.
      if (!Number.isFinite(nowMs) || nowMs < sampledAt) {
        lastError = "clock-skew";
        return;
      }
      if (nowMs - sampledAt > maxAge) {
        lastError = "stale-readback";
        return;
      }
      const ok = perRect.filter((s): s is LuminanceStats => !!s);
      if (!ok.length || ok.length !== perRect.length) {
        lastError = "empty-readback";
        return;
      }
      // Worst case across rects drives the single dim strength.
      const worst = ok.reduce((a, b) => (b.p90 > a.p90 ? b : a));
      latest = { stats: worst, perRect: ok, atMs: sampledAt, key };
      lastError = null;
    },
    fail(t, error) {
      if (!pending || pending.token !== t) return;
      pending = null;
      lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    },
    measurementFor(key, nowMs) {
      if (!latest || latest.key !== key || !Number.isFinite(nowMs)) return null;
      const age = nowMs - latest.atMs;
      // Negative age = clock skew, never "fresh forever".
      return age >= 0 && age <= maxAge ? latest : null;
    },
    latestFresh(nowMs) {
      if (!latest || !Number.isFinite(nowMs)) return null;
      const age = nowMs - latest.atMs;
      return age >= 0 && age <= maxAge ? latest : null;
    },
    get inFlight() {
      return !!pending;
    },
    get lastError() {
      return lastError;
    },
    get reads() {
      return reads;
    },
    noteFrame(dtMs) {
      if (pending && !pending.suspended && Number.isFinite(dtMs) && dtMs >= METER_DROP_FRAME_MS) droppedDuringRead = true;
    },
    get backoff() {
      return { multiplier: mult, intervalMs: interval * mult, lastLatencyMs: lastLatency, reason };
    },
    suspend() {
      if (pending) pending.suspended = true;
    },
    reset() {
      pending = null;
      latest = null;
      lastError = null; // a reconfigured meter must not report a previous layout's failure
      lastKey = "";
      lastStart = -Infinity;
      // Back-off is a property of this device's GPU, not the layout: keep mult
      // and lastLatency across resets so a slow device doesn't re-hammer reads.
      droppedDuringRead = false;
    },
  };
}

/** Downsample shader: 4×4 taps per output texel over the rect (stars don't alias away). */
const DownsampleShader = {
  uniforms: {
    tSrc: { value: null as THREE.Texture | null },
    rect: { value: new THREE.Vector4(0, 0, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSrc;
    uniform vec4 rect;
    varying vec2 vUv;
    void main() {
      vec2 cell = (rect.zw - rect.xy) / ${METER_EDGE.toFixed(1)};
      vec2 base = mix(rect.xy, rect.zw, vUv) - cell * 0.5;
      vec3 acc = vec3(0.0);
      for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
        acc += clamp(texture2D(tSrc, base + cell * (vec2(float(x), float(y)) + 0.5) / 4.0).rgb, 0.0, 1.0);
      }
      gl_FragColor = vec4(acc / 16.0, 1.0);
    }
  `,
};

type ReaderRenderer = Pick<THREE.WebGLRenderer, "getRenderTarget" | "setRenderTarget" | "render" | "readRenderTargetPixels"> & {
  readRenderTargetPixelsAsync?: THREE.WebGLRenderer["readRenderTargetPixelsAsync"];
};

export type RegionReader = {
  /**
   * Downsample each UV rect of `src` into an RGBA8 block and read it back.
   * Resolves to one Uint8Array (METER_EDGE×METER_EDGE×4) per rect. Throws/rejects
   * on GL errors — caller routes to meter.fail.
   */
  read: (renderer: ReaderRenderer, src: THREE.Texture, rects: readonly UvRect[]) => Promise<Uint8Array[]>;
  dispose: () => void;
};

export function createRegionReader(maxRects = 2): RegionReader {
  const rt = new THREE.WebGLRenderTarget(METER_EDGE * maxRects, METER_EDGE, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  rt.texture.name = "light:backdrop-meter";
  const material = new THREE.ShaderMaterial({
    name: "BackdropMeterDownsample",
    uniforms: THREE.UniformsUtils.clone(DownsampleShader.uniforms),
    vertexShader: DownsampleShader.vertexShader,
    fragmentShader: DownsampleShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let disposed = false;

  return {
    async read(renderer, src, rects) {
      if (disposed) throw new Error("meter-disposed");
      const list = rects.slice(0, maxRects);
      if (!list.length) return [];
      const prev = renderer.getRenderTarget();
      const out: Uint8Array[] = [];
      const reads: Promise<unknown>[] = [];
      try {
        material.uniforms.tSrc!.value = src;
        list.forEach((r, i) => {
          material.uniforms.rect!.value.set(r[0], r[1], r[2], r[3]);
          rt.viewport.set(i * METER_EDGE, 0, METER_EDGE, METER_EDGE);
          rt.scissor.set(i * METER_EDGE, 0, METER_EDGE, METER_EDGE);
          rt.scissorTest = true;
          renderer.setRenderTarget(rt);
          renderer.render(scene, cam);
          const buf = new Uint8Array(METER_EDGE * METER_EDGE * 4);
          out.push(buf);
          if (typeof renderer.readRenderTargetPixelsAsync === "function") {
            reads.push(renderer.readRenderTargetPixelsAsync(rt, i * METER_EDGE, 0, METER_EDGE, METER_EDGE, buf));
          } else {
            renderer.readRenderTargetPixels(rt, i * METER_EDGE, 0, METER_EDGE, METER_EDGE, buf);
          }
        });
      } finally {
        material.uniforms.tSrc!.value = null; // never keep the composer buffer bound
        rt.scissorTest = false;
        renderer.setRenderTarget(prev);
      }
      await Promise.all(reads);
      if (disposed) throw new Error("meter-disposed");
      return out;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rt.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}
