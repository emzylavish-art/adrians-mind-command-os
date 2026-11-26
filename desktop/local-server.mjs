import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(serverDir, "..", "public");
const host = process.env.NITRO_HOST || process.env.HOST || "127.0.0.1";
const port = Number(process.env.NITRO_PORT || process.env.PORT || 41731);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const shell = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Adrian's Mind</title>
  <link rel="stylesheet" href="/assets/routes-CMGkX9ke.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/assets/index-CMf-Otm5.js"></script>
  <script type="module" src="/assets/routes-ngNG-W6D.js"></script>
</body>
</html>`;

function sse(text, model = "adrian-local") {
  const done = { text, model, provider: "Adrian", usage: null, usedIds: [], requestId: null };
  return `event: delta\ndata: ${JSON.stringify({ text })}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`;
}

async function localText(text) {
  const mod = await import("./_ssr/session-local-store.mjs");
  if (typeof mod.localReply !== "function") return null;
  return mod.localReply(text);
}

async function grokText(text) {
  // Legacy fallback server cannot prove the selected provider/account. It must never silently dispatch Grok.
  return "This fallback runtime cannot verify the selected provider. Open the packaged app server; no cloud model was called.";
}
async function serveFile(pathname) {
  const file = normalize(join(publicDir, pathname));
  if (!file.startsWith(normalize(publicDir))) return null;
  const info = await stat(file);
  if (!info.isFile()) return null;
  return { body: await readFile(file), type: types[extname(file)] || "application/octet-stream" };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${host}`);
  try {
    if (req.method === "POST" && url.pathname === "/api/mind/turn") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let text = "";
      try {
        text = String(JSON.parse(Buffer.concat(chunks).toString("utf8")).text || "");
      } catch {
        text = "";
      }
      const local = text.trim() ? await localText(text) : null;
      if (local) {
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
        res.end(sse(local));
        return;
      }
      const model = await grokText(text);
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
      res.end(sse(model, model.startsWith("grok-4.3") ? "grok-4.3" : "adrian-local"));
      return;
    }
    if (req.method === "GET") {
      const found = await serveFile(url.pathname === "/" ? "/index.html" : url.pathname).catch(() => null);
      if (found) {
        res.writeHead(200, { "content-type": found.type, "cache-control": "no-store" });
        res.end(found.body);
        return;
      }
      if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/assets/")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(shell);
        return;
      }
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "That route is not in the local listener." }));
  } catch {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "The local listener failed. Nothing was invented." }));
  }
});

server.listen(port, host);
