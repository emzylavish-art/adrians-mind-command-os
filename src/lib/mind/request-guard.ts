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

/**
 * Same decision as the server guard, plus a same-origin POST whose Origin
 * matches the request URL. Does not read x-forwarded-host.
 */
export function decideRequestIsolation(request: {
  method: string;
  url: string;
  headers: { get(name: string): string | null };
}): "allow" | "block" {
  const site = request.headers.get("sec-fetch-site")?.trim().toLowerCase() || null;
  const bySite = decideFetchSite({
    site,
    mode: request.headers.get("sec-fetch-mode"),
    dest: request.headers.get("sec-fetch-dest"),
    method: request.method,
  });
  if (bySite === "allow") return "allow";
  const origin = request.headers.get("origin");
  if (!origin) return "block";
  try {
    if (new URL(origin).origin === new URL(request.url).origin) return "allow";
  } catch {
    return "block";
  }
  return "block";
}
