/** Flag gate for MonoMotionGraphic — kept in .ts so node:test can import it. */
export function isMonoMotionEnabled(
  env: Record<string, string | undefined> = (typeof import.meta !== "undefined"
    ? (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    : undefined) ?? {},
): boolean {
  const v = (env?.VITE_FEATURE_MONO_MOTION || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
