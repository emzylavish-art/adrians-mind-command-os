import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const root = "/home/ubuntu/adrians-mind-command-os/proof/orchestrator";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const record = { ok: false, console: [] };
page.on("console", (message) => {
  if (message.type() === "error") record.console.push(message.text().slice(0, 240));
});
page.on("pageerror", (error) => record.console.push(String(error).slice(0, 240)));
try {
  await page.goto("http://127.0.0.1:4195/", { waitUntil: "domcontentloaded", timeout: 30000 });
  const surface = page.getByRole("button", { name: /Current surface/ });
  await surface.waitFor({ timeout: 15000 });
  await page.getByRole("textbox", { name: "Message" }).waitFor({ timeout: 15000 }).catch(() => undefined);
  const eve = page.getByRole("menuitem", { name: /EVE/ });
  for (let attempt = 0; attempt < 4 && await eve.count() === 0; attempt += 1) {
    await surface.click();
    await page.waitForTimeout(400);
  }
  await eve.click();
  const face = page.getByTestId("talking-head-fallback");
  await face.waitFor({ timeout: 15000 });
  await page.waitForFunction(() => {
    const node = document.querySelector("[data-testid='talking-head-fallback']");
    return node && node.getAttribute("data-state") !== "loading";
  }, { timeout: 45000 });
  record.state = await face.getAttribute("data-state");
  record.source = await face.getAttribute("data-source");
  record.note = await page.getByTestId("talking-head-note").textContent();
  record.canvas = await page.locator("[data-testid='talking-head-stage'] canvas").count();
  const box = await page.locator("[data-testid='talking-head-stage'] canvas").first().boundingBox().catch(() => null);
  record.canvasBox = box;
  record.generatedFaceImages = await page.locator("img[src*='eve-idle']").count();
  record.humanStage = await page.locator("[data-testid='human-stage']").count();
  record.emma = await page.getByTestId("nuance-emma").textContent().catch(() => "");
  record.startedCall = await page.getByTestId("nuance-hangup").count();
  await page.screenshot({ path: `${root}/talking-head-desktop.png` });
  record.ok = record.state === "ready"
    && record.canvas > 0
    && (box?.width ?? 0) > 40
    && record.generatedFaceImages === 0
    && record.humanStage === 0
    && record.startedCall === 0
    && record.source === "https://github.com/met4citizen/TalkingHead";
  writeFileSync(`${root}/talking-head.json`, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
} catch (error) {
  record.error = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: `${root}/talking-head-desktop.png` }).catch(() => undefined);
  writeFileSync(`${root}/talking-head.json`, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
  process.exitCode = 1;
} finally {
  await browser.close();
}
if (!record.ok) process.exit(1);
