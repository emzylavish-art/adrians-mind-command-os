import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const checkout = process.cwd();
const folder = process.env.VISUAL_ARTIFACT_DIR ?? "artifacts/c3-chat-layout";
const base = new URL(process.env.BASE_URL ?? "http://127.0.0.1:4195");
if (base.hostname !== "127.0.0.1" && base.hostname !== "localhost")
  throw Error("This fixture requires a loopback preview.");
const path = "/?section=chat&chat=layout-50";
const sha = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
mkdirSync(folder, { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (!["http:", "https:"].includes(u.protocol)) return route.continue();
    if (u.origin !== base.origin) return route.abort();
    if (u.pathname.startsWith("/api/") || u.pathname.includes("/_serverFn/"))
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"configured":false,"ok":false}',
      });
    return route.continue();
  });
  await context.addInitScript(() => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      id: "turn-" + i,
      role: i % 2 ? "assistant" : "user",
      at: "2026-01-01T12:00:00Z",
      content: `Fixture turn ${i}. Sample message for testing conversation reflow and reading position.`,
    }));
    localStorage.setItem(
      "amcos.workspace.v1",
      JSON.stringify({
        chats: [{ id: "layout-50", title: "Layout fixture 50", messages }],
        projects: [],
        files: [],
      }),
    );
  });
  const page = await context.newPage();
  await page.goto(new URL(path, base).href, { waitUntil: "domcontentloaded" });
  const last = page.getByText("Fixture turn 49.", { exact: false }).first();
  await last.waitFor({ timeout: 60000 });
  const composer = page.locator("form.thread-composer").first();
  await composer.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const file = folder + "/" + sha.slice(0, 7) + "-chat-390x844-50.png";
  await page.screenshot({ path: file, animations: "disabled" });
  writeFileSync(
    file.replace(".png", ".json"),
    JSON.stringify(
      {
        sha,
        route: path,
        fixture: "50 generated turns; browser-only data; external and server operations disabled",
        browser: browser.version(),
        viewport: { width: 390, height: 844 },
        lastMessage: await last.boundingBox(),
        composer: await composer.boundingBox(),
        screenshot: file.split("/").pop(),
        sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
