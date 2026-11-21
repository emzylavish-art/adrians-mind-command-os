import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof/orchestrator";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const record = { ok: false };
try {
  await page.goto("http://127.0.0.1:4195/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("button", { name: /Current surface/ }).click();
  await page.getByRole("menuitem", { name: /EVE/ }).click();
  await page.getByTestId("nuance-persona").waitFor({ timeout: 15000 });
  record.generatedFaceImages = await page.locator("img[src*='eve-idle']").count();
  record.humanStage = await page.locator("[data-testid='human-stage']").count();
  record.personas = await page.getByTestId("nuance-persona").locator("option").allTextContents();
  record.emma = await page.getByTestId("nuance-emma").textContent().catch(() => "");
  await page.screenshot({ path: `${root}/emma-face-desktop.png` });
  record.ok = record.generatedFaceImages === 0 && record.humanStage === 0;
  console.log(JSON.stringify(record));
} catch (error) {
  record.error = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: `${root}/emma-face-desktop.png` }).catch(() => undefined);
  console.log(JSON.stringify(record));
  process.exitCode = 1;
} finally {
  await browser.close();
}
if (!record.ok) process.exit(1);
