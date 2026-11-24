// Serve a local development fixture without real credentials.
// BASE_URL=http://127.0.0.1:8080 node scripts/visual/chat-layout.mjs
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { isolateWorkspace } from "./isolate-workspace.mjs";

const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:4195").origin;
assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Use an isolated local preview.");
const engine = process.env.BROWSER_ENGINE ?? "chromium";
assert(["chromium", "webkit"].includes(engine));
async function centerIsReachable(locator) {
  return locator.evaluate((button) => {
    const box = button.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("button") === button;
  });
}

for (const [width, height, rootPercent] of [[390, 844, 100], [844, 390, 100], [320, 500, 100], [1024, 768, 200]]) {
  const browser = await ({ chromium, webkit })[engine].launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined });
  try {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", serviceWorkers: "block" });
    try {
      await isolateWorkspace(context, origin);
      await context.route((url) => ["https:", "http:"].includes(url.protocol) && url.origin !== origin, (route) => route.abort());
      await context.addInitScript((appOrigin) => {
        if (location.origin !== appOrigin) return;
        const chats = [1, 50].map((count) => ({
          id: "layout-" + count,
          title: "Layout fixture " + count,
          messages: Array.from({ length: count }, (_, i) => ({
            id: "turn-" + i,
            at: "2026-01-01T12:00:00Z",
            role: i % 2 ? "assistant" : "user",
            content: "Turn " + i + ". " + "Sample message for testing conversation reflow. ".repeat(8),
          })),
        }));
        localStorage.setItem("amcos.workspace.v1", JSON.stringify({ chats }));
      }, origin);
      const page = await context.newPage();
      await page.goto(origin);
      const home = page.locator("#command-home");
      await home.getByRole("heading", { level: 1 }).waitFor();
      const greeting = await home.locator(".masthead").boundingBox();
      const homeBox = await home.boundingBox();
      assert(greeting && homeBox && greeting.y - homeBox.y < 80, "Large blank gap before the Home greeting.");
      const homeTrigger = home.locator("details.composer-more > summary");
      await homeTrigger.click();
      await page.getByTestId("home-composer-more-menu").getByRole("button", { name: "Attach", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByTestId("home-composer-more-menu").waitFor({ state: "hidden" });
      for (const count of [1, 50]) {
        await page.goto(origin + "/?section=chat&chat=layout-" + count);
        await page.locator("article.turn").nth(count - 1).waitFor({ state: "attached" });
        if (rootPercent !== 100) await page.addStyleTag({ content: `html {font-size:${rootPercent}% !important}` });
        const composer = page.locator("form.thread-composer");
        const message = composer.getByRole("textbox", { name: "Message", exact: true });
        await message.fill("An editable draft");
        if (count === 50) {
          await page.locator('input[type=file][accept^="image/png"]').setInputFiles({
            name: "release-" + "long-file-name-".repeat(12) + "review.png",
            mimeType: "image/png",
            buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAWJVMogAAAAASUVORK5CYII=", "base64"),
          });
          await composer.getByRole("list", { name: "Attached images" }).waitFor();
          await message.fill(Array(15).fill("Multiline draft").join("\n"));
        }
        assert(await centerIsReachable(composer.getByRole("button", { name: "Send", exact: true })), `Send clipped on ${width}×${height} / ${count} turns.`);
        if (count === 1) continue;
        const chip = await composer.getByRole("listitem").first().boundingBox();
        assert(chip && chip.x >= 0 && chip.x + chip.width <= width + 1, "Attachment extends outside viewport.");
        const trigger = composer.locator("details.composer-more > summary");
        await trigger.click();
        const menu = page.getByTestId("composer-more-menu");
        await menu.waitFor();
        for (const button of await menu.getByRole("button").all()) {
          await button.scrollIntoViewIfNeeded();
          assert(await centerIsReachable(button), "Unreachable action in More: " + await button.textContent());
        }
        await trigger.focus();
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
        assert(await trigger.evaluate((element) => document.activeElement === element), "More lost focus on Escape.");
        const transcript = page.locator("#chat-thread > section > .overflow-auto");
        await transcript.evaluate((el) => { el.scrollTop -= 400; });
        await page.getByRole("button", { name: "Jump to latest" }).click();
        await page.waitForFunction(() => {
          const el = document.querySelector("#chat-thread > section > .overflow-auto");
          return el && el.scrollHeight - el.scrollTop - el.clientHeight <= 2;
        });
      }
      console.log(`PASS ${engine} ${width}×${height}, ${rootPercent}% root text, short/long conversation and attachment.`);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
