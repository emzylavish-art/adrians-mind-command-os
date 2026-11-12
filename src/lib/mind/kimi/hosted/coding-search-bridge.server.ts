import { createServer, type Server } from "node:http";
import { searchWithGrok } from "../../xai-search.ts";

const PORT = 58641;

let server: Server | null = null;

export function codingSearchUrl(): string {
  return `http://127.0.0.1:${PORT}/search`;
}

export async function ensureCodingSearchBridge(): Promise<{ ok: boolean; url: string; error?: string }> {
  const url = codingSearchUrl();
  if (server?.listening) return { ok: true, url };
  try {
    const existing = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(800) });
    if (existing.status === 200 || existing.status === 502) return { ok: true, url };
  } catch {
    // The bridge is not listening yet.
  }
  server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/search") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ search_results: [] }));
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      void (async () => {
        let query = "";
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { text_query?: unknown };
          query = typeof body.text_query === "string" ? body.text_query : "";
        } catch {
          query = "";
        }
        const result = await searchWithGrok(query);
        if (!result.ok) {
          response.writeHead(502, { "content-type": "application/json" });
          response.end(JSON.stringify({ search_results: [], error: result.error || "Search returned no sources." }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({
          search_results: result.citations.slice(0, 5).map((item) => ({
            title: item.title,
            url: item.url,
            snippet: item.title,
            site_name: safeHost(item.url),
          })),
        }));
      })().catch(() => {
        response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ search_results: [] }));
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(PORT, "127.0.0.1", () => resolve());
  });
  return { ok: true, url };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
