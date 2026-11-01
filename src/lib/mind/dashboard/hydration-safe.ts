/**
 * Helpers that keep DashboardApp / UniverseScene first paint SSR-identical.
 * No Date.now(), window, localStorage, or random on the first render path.
 */

export function firstPaintReducedMotion(): boolean {
  // Always false for SSR + first client paint; matchMedia runs in useEffect.
  return false;
}

export function firstPaintOperatorPrefs<T extends { layers: object }>(defaults: T): T {
  return { ...defaults, layers: { ...defaults.layers } };
}

/** True when a source expression is unsafe for the first React render (hydration). */
export function isUnsafeFirstPaintSource(source: string): boolean {
  const s = source;
  return (
    /\bDate\.now\s*\(/.test(s) ||
    /\bMath\.random\s*\(/.test(s) ||
    /\bwindow\./.test(s) ||
    /\blocalStorage\b/.test(s) ||
    /\bsessionStorage\b/.test(s) ||
    /\bmatchMedia\s*\(/.test(s) ||
    /\bperformance\.now\s*\(/.test(s)
  );
}
