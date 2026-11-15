import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof/phone";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

async function menu(label) {
  await page.getByRole("button", { name: "Open menu" }).click();
  const item = page.getByRole("button", { name: label, exact: true });
  if (!(await item.count())) await page.getByRole("dialog", { name: "Workspace navigation" }).locator("summary", { hasText: "More" }).click();
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForTimeout(300);
}

async function shot(name) {
  await page.screenshot({ path: `${root}/${name}.png`, fullPage: true });
}

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
await menu("EVE");
await shot("eve-talk");
for (const band of ["Status", "Pairing", "Tasks", "Figure", "Records"]) {
  await page.getByRole("button", { name: band, exact: true }).click();
  await page.waitForTimeout(200);
  await shot(`eve-${band.toLowerCase()}`);
}
await menu("Build");
await page.getByRole("button", { name: "Workspace", exact: true }).click();
await shot("build-workspace");
await menu("Research");
await page.getByRole("button", { name: "Saved", exact: true }).first().click();
await shot("research-saved");
console.log("captured");
await browser.close();
