#!/usr/bin/env node
const url = process.argv[2] ?? "";
const dataAllowed = process.env.MIND_BROWSER_ALLOW_DATA === "1";
const http = /^https?:\/\/\S+$/i.test(url);
const data = dataAllowed && url.startsWith("data:text/html,");
if (!http && !data) {
  console.log(JSON.stringify({ ok: false, error: "Only an http(s) page can be opened. No page was opened." }));
  process.exit(0);
}
if (url.includes("@") && http) {
  console.log(JSON.stringify({ ok: false, error: "A URL with credentials was refused. No page was opened." }));
  process.exit(0);
}

// Data URLs are used for the offline smoke test. Read them directly so the
// smoke check does not depend on a separately downloaded Playwright browser.
if (data) {
  try {
    const html = decodeURIComponent(url.slice("data:text/html,".length));
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const excerpt = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    console.log(JSON.stringify({ ok: true, title, excerpt }));
  } catch {
    console.log(JSON.stringify({ ok: false, error: "The data page could not be opened." }));
  }
  process.exit(0);
}

const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
  const title = await page.title();
  const excerpt = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, 500);
  console.log(JSON.stringify({ ok: true, title, excerpt }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "The page did not open." }));
} finally {
  await browser.close();
}
