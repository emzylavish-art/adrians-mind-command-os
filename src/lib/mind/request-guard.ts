export function decideFetchSite(input: {
  site: string | null;
  mode: string | null;
  dest: string | null;
  method: string;
}): "allow" | "block" {
  if (!input.site || input.site === "same-origin" || input.site === "none") return "allow";
  const topLevelGet =
    input.mode === "navigate" &&
    input.method === "GET" &&
    input.dest !== "object" &&
    input.dest !== "embed";
  return topLevelGet ? "allow" : "block";
}
