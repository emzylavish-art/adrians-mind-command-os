import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof/phone";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(500);
await page.screenshot({ path: `${root}/chat.png`, fullPage: true });

const drawer = ["Build", "Intelligence", "Research", "Projects", "Library", "Plugins", "Scheduled"];
for (const label of drawer) {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${root}/${label.toLowerCase()}.png`, fullPage: true });
}

await page.getByRole("button", { name: "Open menu" }).click();
await page.locator("summary", { hasText: "More" }).click();
for (const label of ["EVE", "Bots", "Tools", "Skills", "Runs", "Memory", "Activity", "Help"]) {
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${root}/${label.toLowerCase()}.png`, fullPage: true });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.locator("summary", { hasText: "More" }).click();
}
await page.getByRole("button", { name: "Open Settings" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${root}/settings.png`, fullPage: true });
console.log("captured");
await browser.close();
