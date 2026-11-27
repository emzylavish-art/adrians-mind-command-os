export type AccessibilityPreferences = { textScale: 100 | 125 | 150 | 200; contrast: "standard" | "high"; spacing: "standard" | "comfortable" };
export const ACCESSIBILITY_KEY = "amcos.accessibility.v1";
export function readAccessibility(raw: string | null): AccessibilityPreferences {
  try { const row = JSON.parse(raw || "{}"); return { textScale: [100, 125, 150, 200].includes(row.textScale) ? row.textScale : 100, contrast: row.contrast === "high" ? "high" : "standard", spacing: row.spacing === "comfortable" ? "comfortable" : "standard" }; }
  catch { return { textScale: 100, contrast: "standard", spacing: "standard" }; }
}
