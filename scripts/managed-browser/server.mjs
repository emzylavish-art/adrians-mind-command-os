import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { browserInput, managedBrowserId, managedBrowserOrigins } from "../../src/lib/mind/managed-browser.ts";
import { createBrowserRuntime } from "./runtime.mjs";

export function createBrowserWorker({ token, runtime }) {
  if (typeof token !== "string" || token.length < 32) throw new Error("The browser worker bearer must be configured");
  const expected = Buffer.from("Bearer " + token);
  return createServer(async (req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || req.url !== "/session") return json(404, { error: "Browser worker route unavailable." });
    const supplied = Buffer.from(req.headers.authorization ?? "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(401, { error: "Worker authorization required." });
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 4096) return json(413, { error: "Browser request exceeded its limit." });
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const input = data && browserInput(data);
      if (!input || typeof data.id !== "string" || !managedBrowserId.test(data.id)) return json(400, { error: "Invalid browser request." });
      const result = await runtime.run({ id: data.id, input, target: data.target, expires: data.expires });
      json(result.status, result.body);
    } catch { if (!res.headersSent) json(503, { error: "Browser worker could not confirm the action." }); }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const origins = managedBrowserOrigins(process.env.ADRIAN_MANAGED_BROWSER_ORIGINS);
  if (!origins.size) throw new Error("Configure at least one approved website origin for the browser worker");
  const runtime = createBrowserRuntime({ origins, executablePath: process.env.ADRIAN_MANAGED_BROWSER_CHROMIUM });
  const server = createBrowserWorker({ token: process.env.ADRIAN_MANAGED_BROWSER_TOKEN, runtime });
  const port = Number(process.env.ADRIAN_MANAGED_BROWSER_PORT ?? "8791");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid browser worker port");
  server.requestTimeout = 12000;
  server.listen(port, "127.0.0.1", () => process.stdout.write("Managed browser worker listening on loopback.\n"));
  for (const event of ["SIGINT", "SIGTERM"]) process.once(event, () => {
    server.close();
    void runtime.close().catch(() => { process.exitCode = 1; });
  });
}
