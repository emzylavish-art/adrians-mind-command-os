export type CopyState = "idle" | "copied" | "failed";

export function copyButtonLabel(state: CopyState): string {
  if (state === "copied") return "Copied";
  if (state === "failed") return "Copy failed";
  return "Copy code";
}
