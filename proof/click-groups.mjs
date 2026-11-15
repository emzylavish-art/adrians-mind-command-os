import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof/phone";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const report = [];

async function menu(label) {
  await page.getByRole("button", { name: "Open menu" }).click();
  const item = page.getByRole("button", { name: label, exact: true });
  if (!(await item.count())) await page.getByRole("dialog", { name: "Workspace navigation" }).locator("summary", { hasText: "More" }).click();
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForTimeout(250);
}

async function band(nav, label) {
  await page.getByRole("navigation", { name: nav }).getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(150);
}

async function check(name) {
  const wide = await page.evaluate(() => {
    return [...document.querySelectorAll("button, a, p, h2, h3, input, textarea")]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 8 && el.getClientRects().length)
      .slice(0, 6)
      .map((el) => `${el.tagName} ${(el.textContent || "").trim().slice(0, 40)}`);
  });
  await page.screenshot({ path: `${root}/click-${name}.png` });
  report.push({ name, wide });
}

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
await menu("Research");
for (const label of ["Ask", "Saved", "Files"]) {
  await band("Research page", label);
  await check(`research-${label.toLowerCase()}`);
}
await menu("Library");
for (const label of ["Files", "Preview"]) {
  await band("Library groups", label);
  await check(`library-${label.toLowerCase()}`);
}
await menu("Scheduled");
for (const label of ["Jobs", "New job"]) {
  await band("Schedule groups", label);
  await check(`scheduled-${label.toLowerCase().replace(" ", "-")}`);
}
await menu("Build");
for (const label of ["Actions", "Workspace", "Message", "Editor"]) {
  await band("Build sections", label);
  await check(`build-${label.toLowerCase()}`);
}
await menu("EVE");
for (const label of ["Talk", "Status", "Pairing", "Tasks", "Figure", "Records"]) {
  await band("EVE groups", label);
  await check(`eve-${label.toLowerCase()}`);
}
console.log(JSON.stringify(report, null, 2));
await browser.close();
