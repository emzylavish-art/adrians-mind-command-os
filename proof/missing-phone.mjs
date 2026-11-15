import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof/phone";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const report = [];

async function menu(label) {
  await page.getByRole("button", { name: "Open menu" }).click();
  const item = page.getByRole("button", { name: label, exact: true });
  if (!(await item.count())) await page.locator("summary", { hasText: "More" }).click();
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForTimeout(300);
}

async function shot(name) {
  const box = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("*")];
    const scroller = nodes.find((el) => el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 300 && getComputedStyle(el).overflowY !== "visible");
    if (scroller) {
      scroller.style.height = `${scroller.scrollHeight}px`;
      scroller.style.maxHeight = "none";
      scroller.style.overflow = "visible";
    }
    const wide = nodes.filter((el) => el.getBoundingClientRect().right > window.innerWidth + 4).slice(0, 5).map((el) => el.className?.toString?.().slice(0, 80) || el.tagName);
    return { wide, height: document.body.scrollHeight };
  });
  await page.screenshot({ path: `${root}/${name}.png`, fullPage: true });
  report.push({ name, ...box });
}

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
await menu("Research");
await page.getByRole("button", { name: "Ask", exact: true }).first().click();
await shot("research-ask");
await page.getByRole("button", { name: "Saved", exact: true }).first().click();
await shot("research-saved");
await page.getByRole("button", { name: "Files", exact: true }).first().click();
await shot("research-files");

await menu("Library");
await page.getByRole("button", { name: "Files", exact: true }).click();
await shot("library-files");
await page.getByRole("button", { name: "Preview", exact: true }).click();
await shot("library-preview");

await menu("Scheduled");
await page.getByRole("button", { name: "Jobs", exact: true }).click();
await shot("scheduled-jobs");
await page.getByRole("button", { name: "New job", exact: true }).click();
await shot("scheduled-new");

await menu("Build");
for (const band of ["Actions", "Workspace", "Message", "Editor"]) {
  await page.getByRole("button", { name: band, exact: true }).click();
  await page.waitForTimeout(200);
  await shot(`build-${band.toLowerCase()}`);
}

await menu("EVE");
await shot("eve");
console.log(JSON.stringify(report, null, 2));
await browser.close();
