import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const report = { speak: {}, settings: {}, failures: [] };
try {
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Build", exact: true }).first().click();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByTestId("owner-flow-speak").click();
  await page.getByTestId("speak-face").waitFor();
  await page.getByRole("button", { name: "Voice settings" }).click();
  await page.getByRole("heading", { name: "Voice settings" }).waitFor();
  await page.getByRole("button", { name: "Unhinged" }).click();
  await page.getByRole("button", { name: "Storyteller" }).click();
  report.speak.unhinged = await page.getByRole("button", { name: "Unhinged" }).getAttribute("aria-pressed");
  report.speak.storyteller = await page.getByRole("button", { name: "Storyteller" }).getAttribute("aria-pressed");
  await page.screenshot({ path: `${root}/click-speak-settings-phone.png` });
  await page.getByRole("button", { name: "Close voice settings" }).click();
  await page.getByRole("button", { name: "End call" }).click();
  await page.getByTestId("speak-stage").waitFor({ state: "hidden", timeout: 5000 });
  report.speak.closed = true;
  const gear = page.locator("button[aria-label='Open Settings'], button[aria-label='Settings']").first();
  if (await gear.count()) {
    await gear.click();
  } else {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByText("More", { exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
  }
  await page.waitForTimeout(400);
  report.settings.overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  report.settings.headings = await page.locator("h2, h3").allTextContents();
  await page.screenshot({ path: `${root}/click-settings-phone.png` });
} catch (error) {
  report.failures.push(error instanceof Error ? error.message : String(error));
  await page.screenshot({ path: `${root}/click-speak-settings-phone.png` }).catch(() => undefined);
}
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (report.failures.length) process.exit(1);
