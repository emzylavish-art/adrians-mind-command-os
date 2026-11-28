import { chromium } from "playwright";
import { managedBrowserUrl, managedBrowserWidth, managedBrowserHeight, managedBrowserLifetimeMs } from "../../src/lib/mind/managed-browser.ts";
import { readBrowserResource, resolveBrowserPin } from "./network.mjs";

const denied = (status, error) => ({ status, body: { error } });
const ok = body => ({ status: 200, body });
const csp = "default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'none'; base-uri 'none'; frame-src 'none'; sandbox allow-same-origin";
const resourceTypes = new Set(["document", "stylesheet", "image", "font"]);

export function createBrowserRuntime({ origins, load = readBrowserResource, pin = resolveBrowserPin, executablePath, chromiumSandbox = true } = {}) {
  const sessions = new Map();
  const revoked = new Map();
  let browserPromise;
  let closed = false;
  const browser = () => browserPromise ??= chromium.launch({
    executablePath, headless: true, chromiumSandbox,
    env: { PATH: process.env.PATH, LANG: process.env.LANG, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
    args: ["--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>", "--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
  }).then(instance => {
    instance.once("disconnected", () => { browserPromise = undefined; });
    return instance;
  }).catch(error => { browserPromise = undefined; throw error; });

  async function drop(id, session) {
    clearTimeout(session.timer);
    session.abort.abort();
    // A closing context still counts toward capacity until Chromium confirms it.
    session.phase = "closed";
    try { await session.context?.close(); }
    finally { if (sessions.get(id) === session) sessions.delete(id); }
  }

  async function navigate(page, url) {
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 4800 });
    if (!response?.ok()) throw new Error("Website document unavailable");
  }

  async function capture(page, manual = false) {
    const url = managedBrowserUrl(page.url());
    if (!url) throw new Error("No approved page to display");
    let image = await page.screenshot({ type: "jpeg", quality: 68, timeout: 1700 });
    if (image.length > 415_000) image = await page.screenshot({ type: "jpeg", quality: 42, timeout: 1700 });
    if (image.length > 415_000) throw new Error("Browser frame too large");
    const links = manual ? await page.evaluate(() => {
      const visible = [];
      for (const anchor of document.querySelectorAll("a[href]")) {
        let target;
        try { target = new URL(anchor.href, location.href); }
        catch { continue; }
        if (target.origin !== location.origin || target.search || target.hash || target.username || target.password) continue;
        const bounds = anchor.getBoundingClientRect();
        const x = Math.floor((Math.max(0, bounds.left) + Math.min(window.innerWidth, bounds.right)) / 2);
        const y = Math.floor((Math.max(0, bounds.top) + Math.min(window.innerHeight, bounds.bottom)) / 2);
        if (document.elementFromPoint(x, y)?.closest("a[href]") !== anchor) continue;
        const label = (anchor.textContent || anchor.getAttribute("aria-label") || target.pathname).replace(/\s+/g, " ").trim();
        visible.push({ x, y, label: label.slice(0, 120) || target.pathname.slice(0, 120) });
        if (visible.length >= 20) break;
      }
      return visible;
    }) : undefined;
    return { image: image.toString("base64"), path: url.pathname, links };
  }

  async function run({ id, input, target, expires }) {
    if (closed) return denied(503, "The browser worker is stopping.");
    const now = Date.now();
    for (const [key, until] of revoked) if (until <= now) revoked.delete(key);
    const existing = sessions.get(id);
    if (input.action === "stop") {
      // Hold the cancellation briefly in case a reserved start is still in transit.
      if (revoked.size >= 1024 && !revoked.has(id) && !existing) return denied(503, "The worker cannot confirm cancellation.");
      revoked.set(id, now + 30_000);
      if (existing) await drop(id, existing);
      return ok({ phase: "closed" });
    }
    if (input.action === "start") {
      if (revoked.has(id)) return ok({ phase: "closed" });
      if (revoked.size >= 1024) return denied(503, "The worker is clearing prior cancellations.");
      if (existing) return denied(409, "This session ID is already in use. Check its state.");
      const url = managedBrowserUrl(target);
      const remaining = expires - Date.now();
      if (!url || !origins.has(url.origin) || !Number.isFinite(remaining) || remaining <= 0 || remaining > managedBrowserLifetimeMs) {
        return denied(400, "This approved website or session expiration is invalid.");
      }
      if (sessions.size >= 4) return denied(503, "The isolated browser worker is at capacity.");
      const session = { phase: "managed", busy: true, origin: url.origin, expires, abort: new AbortController(), context: null, page: null, timer: null };
      sessions.set(id, session);
      session.timer = setTimeout(() => void drop(id, session).catch(() => {}), remaining);
      try {
        const pinAddress = await pin(url.hostname);
        session.abort.signal.throwIfAborted();
        const instance = await browser();
        session.abort.signal.throwIfAborted();
        session.context = await instance.newContext({
          javaScriptEnabled: false, serviceWorkers: "block", acceptDownloads: false,
          viewport: { width: managedBrowserWidth, height: managedBrowserHeight },
        });
        session.abort.signal.throwIfAborted();
        let requests = 0;
        let bytes = 0;
        await session.context.routeWebSocket("**/*", socket => socket.close());
        await session.context.route("**/*", async route => {
          try {
            const request = route.request(), address = new URL(request.url());
            if (address.origin !== session.origin || address.href.length > 2048 || request.method() !== "GET" ||
                address.username || address.password || !resourceTypes.has(request.resourceType()) ||
                (request.resourceType() === "document" && (!managedBrowserUrl(address.href) || request.frame() !== session.page?.mainFrame())) ||
                ++requests > 100 || bytes > 8_000_000) {
              await route.abort();
              return;
            }
            const result = await load(address, pinAddress, session.abort.signal);
            bytes += result.body.length;
            if (bytes > 8_000_000) { await route.abort(); return; }
            await route.fulfill({ status: 200, contentType: result.contentType, body: result.body,
              headers: { "content-security-policy": csp, "x-content-type-options": "nosniff", "cache-control": "no-store" } });
          } catch { await route.abort().catch(() => {}); }
        });
        session.page = await session.context.newPage();
        await navigate(session.page, url);
        return ok({ phase: session.phase, frame: await capture(session.page) });
      } catch {
        await drop(id, session).catch(() => {});
        return denied(422, "The isolated browser could not display that page.");
      } finally { session.busy = false; }
    }
    if (!existing) return ok({ phase: "closed" });
    if (Date.now() >= existing.expires) {
      await drop(id, existing);
      return ok({ phase: "closed" });
    }
    if (existing.busy) return denied(409, "A browser action is already running.");
    existing.busy = true;
    try {
      if (existing.phase === "closed") return ok({ phase: "closed" });
      const page = existing.page;
      if (!page || page.isClosed()) { await drop(id, existing); return ok({ phase: "closed" }); }
      if (input.action === "takeover") {
        if (existing.phase !== "managed") return denied(409, "The owner already controls this browser.");
        existing.phase = "manual";
      }
      if (input.action === "handback") {
        if (existing.phase !== "manual") return denied(409, "The session is already in managed view.");
        existing.phase = "managed";
      }
      if (input.action === "follow" || input.action === "scroll") {
        if (existing.phase !== "manual") return denied(409, "Take control before interacting.");
        if (input.action === "follow") {
          const destination = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("a[href]")?.href ?? null, input);
          const url = managedBrowserUrl(destination);
          if (!url || url.origin !== existing.origin) return ok({ phase: existing.phase, frame: await capture(page, true), refusedLink: true });
          await navigate(page, url);
        } else {
          await page.evaluate(delta => window.scrollBy(0, delta), input.delta);
        }
      }
      return ok({ phase: existing.phase, frame: await capture(page, existing.phase === "manual") });
    } catch {
      return denied(422, "The browser action could not display a page.");
    } finally { existing.busy = false; }
  }

  async function close() {
    closed = true;
    await Promise.allSettled([...sessions].map(([id, session]) => drop(id, session)));
    await (await browserPromise?.catch(() => undefined))?.close();
  }
  return { run, close };
}
