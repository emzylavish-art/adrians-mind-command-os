import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { approvedBrowserOrigins, managedBrowserAction, managedBrowserId, MANAGED_VIEWPORT } from "../src/lib/mind/managed-browser.ts";

function sameSecret(actual, expected) {
  const a = Buffer.from(actual ?? "");
  const b = Buffer.from("Bearer " + expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createManagedBrowserWorker({ token, origins, launch, fetchPage = route => route.fetch({ maxRedirects: 0, timeout: 6000 }), now = Date.now }) {
  const active = new Map();
  const closed = new Map();
  const limit = 5;
  const lifetime = 15 * 60_000;

  async function close(id, session) {
    await session.browser?.close();
    active.delete(id);
    closed.set(id, now() + lifetime);
  }

  async function command(id, operation, action) {
    const existing = active.get(id);
    if (existing?.busy) return { error: "A browser action is still running.", status: 409 };
    if (existing && (existing.expires <= now() || !existing.browser.isConnected() || existing.page.isClosed())) {
      await close(id, existing);
      return { mode: "stopped" };
    }
    if (action.kind === "status") return { mode: existing?.mode ?? "stopped" };
    if (existing?.operations.has(operation)) return existing.operations.get(operation);
    if (action.kind === "start") {
      if (existing || closed.has(id)) return { error: "This browser session already exists.", status: 409 };
      if (!origins.includes(action.origin)) return { error: "This site is outside the configured browser scope.", status: 403 };
      if (active.size >= limit) return { error: "All managed browser seats are in use.", status: 429 };
      const session = { mode: "managed", busy: true, expires: now() + lifetime, operations: new Map(), browser: null, page: null };
      active.set(id, session);
      try {
        session.browser = await launch();
        const context = await session.browser.newContext({ viewport: MANAGED_VIEWPORT, serviceWorkers: "block", acceptDownloads: false });
        await context.route("**/*", async route => {
          const request = route.request();
          const method = request.method();
          if (new URL(request.url()).origin !== action.origin ||
              (session.mode !== "takeover" && method !== "GET" && method !== "HEAD")) return route.abort();
          try {
            const upstream = await fetchPage(route);
            if (upstream.status() >= 300 && upstream.status() < 400 && upstream.status() !== 304) return await route.abort();
            return await route.fulfill({ response: upstream });
          } catch { return route.abort(); }
        });
        await context.routeWebSocket("**/*", socket => socket.close());
        session.page = await context.newPage();
        session.page.on("popup", page => { void page.close().catch(() => {}); });
        session.page.on("dialog", dialog => { void dialog.dismiss().catch(() => {}); });
        await session.page.goto(action.origin, { waitUntil: "domcontentloaded", timeout: 8000 });
        const status = { mode: "managed" };
        session.operations.set(operation, status);
        return status;
      } catch {
        await close(id, session);
        return { error: "The approved site could not be opened.", status: 422 };
      } finally { session.busy = false; }
    }
    if (!existing) return action.kind === "stop" ? { mode: "stopped" } : { status: 409, error: "The browser session is closed." };
    existing.busy = true;
    try {
      if (action.kind === "stop") {
        await close(id, existing);
        return { mode: "stopped" };
      }
      if (action.kind === "takeover") {
        if (existing.mode !== "managed") return { status: 409, error: "The owner already controls the browser." };
        existing.mode = "takeover";
      } else if (action.kind === "handback") {
        if (existing.mode !== "takeover") return { status: 409, error: "The browser is already in managed mode." };
        existing.mode = "managed";
      } else if (action.kind !== "capture") {
        if (existing.mode !== "takeover") return { status: 409, error: "Take over the browser before sending input." };
        if (action.kind === "click") await existing.page.mouse.click(action.x, action.y);
        if (action.kind === "text") await existing.page.keyboard.insertText(action.text);
        if (action.kind === "key") await existing.page.keyboard.press(action.key);
      }
      const result = { mode: existing.mode };
      if (action.kind !== "capture") existing.operations.set(operation, result);
      if (existing.operations.size > 128) existing.operations.delete(existing.operations.keys().next().value);
      const frame = await existing.page.screenshot({ type: "jpeg", quality: 52, timeout: 3000 });
      return { ...result, frame: frame.toString("base64") };
    } finally { existing.busy = false; }
  }

  const server = createServer(async (request, response) => {
    function send(status, body) {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(body));
    }
    if (!sameSecret(request.headers.authorization, token)) return send(401, { error: "Worker authorization is required." });
    const [, resource, id, operation, extra] = (request.url ?? "").split("/");
    if (request.method !== "POST" || resource !== "session" || extra || !managedBrowserId(id) || !managedBrowserId(operation)) return send(404, { error: "Invalid browser worker operation." });
    try {
      let raw = "";
      for await (const chunk of request) {
        raw += chunk.toString();
        if (raw.length > 2048) return send(413, { error: "The browser request is too large." });
      }
      const action = managedBrowserAction(JSON.parse(raw));
      if (!action) return send(400, { error: "Invalid browser action." });
      const result = await command(id, operation, action);
      return send(result.status ?? 200, result);
    } catch { return send(503, { error: "The browser operation could not be confirmed." }); }
  });
  const sweep = setInterval(() => {
    for (const [id, session] of active) {
      if (!session.busy && session.expires <= now()) {
        session.busy = true;
        void close(id, session).catch(() => { session.busy = false; });
      }
    }
    for (const [id, expires] of closed) if (expires <= now()) closed.delete(id);
  }, 10_000);
  sweep.unref();
  return {
    server,
    async shutdown() {
      clearInterval(sweep);
      await Promise.allSettled([...active].map(([id, session]) => close(id, session)));
      await new Promise(resolve => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.ADRIAN_MANAGED_BROWSER_TOKEN;
  const origins = approvedBrowserOrigins(process.env.ADRIAN_MANAGED_BROWSER_ORIGINS);
  if (!token || token.length < 32 || !origins.length) throw Error("Configure the browser worker token and at least one approved HTTPS origin.");
  const worker = createManagedBrowserWorker({ token, origins, launch: () => chromium.launch({ chromiumSandbox: true, timeout: 8000 }) });
  worker.server.listen(Number(process.env.ADRIAN_MANAGED_BROWSER_PORT || 8791), process.env.ADRIAN_MANAGED_BROWSER_BIND || "127.0.0.1");
  process.once("SIGTERM", () => void worker.shutdown());
  process.once("SIGINT", () => void worker.shutdown());
}
