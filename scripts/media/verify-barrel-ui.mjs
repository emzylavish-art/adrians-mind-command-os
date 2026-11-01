import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const base = "http://127.0.0.1:8097";
const outDir = "/workspace/audit/media-integration";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const page = await browser.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (err) => pageErrors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

await page.goto(base + "/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);

// Dismiss any gate if present
const continueBtn = page.getByRole("button", { name: /continue|enter|start|dev/i }).first();
if (await continueBtn.isVisible().catch(() => false)) {
  await continueBtn.click().catch(() => {});
  await page.waitForTimeout(800);
}

const bodyText = await page.locator("body").innerText().catch(() => "");
const fsCrash =
  pageErrors.some((e) => /node:fs|existsSync/i.test(e)) ||
  consoleErrors.some((e) => /node:fs|existsSync/i.test(e)) ||
  /Cannot access node:fs/i.test(bodyText);

await page.screenshot({ path: `${outDir}/v2-barrel-fix-home.png`, fullPage: true });

const attach = page.getByRole("button", { name: /^Attach$/i }).first();
const imageBtn = page.getByRole("button", { name: /^Image$/i }).first();
const camera = page.getByRole("button", { name: /^Camera$/i }).first();

const attachVisible = await attach.isVisible().catch(() => false);
const imageVisible = await imageBtn.isVisible().catch(() => false);
const cameraVisible = await camera.isVisible().catch(() => false);

let cameraDialog = false;
if (cameraVisible) {
  await camera.click();
  await page.waitForTimeout(1000);
  cameraDialog = await page.getByRole("dialog").isVisible().catch(() => false);
  if (!cameraDialog) {
    // some UIs use heading
    cameraDialog = await page.getByText(/camera|capture|snapshot/i).first().isVisible().catch(() => false);
  }
  await page.screenshot({ path: `${outDir}/v2-barrel-fix-camera.png`, fullPage: true });
  // close if possible
  const close = page.getByRole("button", { name: /close|cancel|done/i }).first();
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
}

const result = {
  ok: !fsCrash && attachVisible && cameraVisible,
  fsCrash,
  attachVisible,
  imageVisible,
  cameraVisible,
  cameraDialog,
  pageErrors: pageErrors.slice(0, 10),
  consoleErrors: consoleErrors.filter((e) => /node:fs|existsSync|media/i.test(e)).slice(0, 10),
  at: new Date().toISOString(),
};
writeFileSync(`${outDir}/v2-barrel-fix-result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.ok ? 0 : 1);
