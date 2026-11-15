import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const result = { ok: false };
try {
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByLabel("Switch between Chat, Build, Intelligence, and EVE").click();
  await page.getByRole("menuitem", { name: /EVE/ }).click();
  await page.getByLabel("Ask EVE").waitFor({ timeout: 15000 });
  await page.waitForTimeout(1100);
  const stage = page.locator(".eve-stage-panel").first();
  await stage.screenshot({ path: `${root}/eve-body-finished.png` });
  await stage.screenshot({ path: `${root}/eve-body-first.png` });
  await page.getByRole("button", { name: "face", exact: true }).click();
  await page.waitForTimeout(300);
  const close = page.locator(".eve-stage-3d").last();
  await page.evaluate(() => { window.__eveHold = "blink"; window.__eveGaze = "center"; window.__eveYaw = 0; });
  await page.waitForFunction(() => document.querySelector("[data-testid='human-stage']")?.getAttribute("data-blink") === "1");
  await page.waitForTimeout(250);
  result.blink = await page.locator("[data-testid='human-stage']").first().evaluate((node) => ({
    blink: node.getAttribute("data-blink"),
    facing: node.getAttribute("data-facing"),
  }));
  await close.screenshot({ path: `${root}/eve-body-blink-proof.png` });
  await page.evaluate(() => { window.__eveHold = "blink"; window.__eveGaze = "center"; window.__eveYaw = Math.PI; });
  await page.waitForFunction(() => document.querySelector("[data-testid='human-stage']")?.getAttribute("data-facing") === "turned");
  await page.waitForFunction(() => document.querySelector("[data-testid='human-stage']")?.getAttribute("data-blink") === "1");
  await page.waitForTimeout(250);
  result.turn = await page.locator("[data-testid='human-stage']").first().getAttribute("data-facing");
  result.turnBlink = await page.locator("[data-testid='human-stage']").first().getAttribute("data-blink");
  await close.screenshot({ path: `${root}/eve-body-turn-proof.png` });
  await page.evaluate(() => { window.__eveYaw = Math.PI * 0.55; });
  await page.waitForTimeout(300);
  await close.screenshot({ path: `${root}/eve-body-full-turn.png` });
  result.ok = result.blink.blink === "1" && result.blink.facing !== "turned" && result.turn === "turned" && result.turnBlink === "1";
  console.log(JSON.stringify(result));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
if (!result.ok) process.exit(1);
