import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const report = { panels: [], tools: [], failures: [] };
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Open menu" }).click();
await page.getByRole("button", { name: "Build", exact: true }).first().click();
await page.getByRole("button", { name: "Editor", exact: true }).click();
const nav = page.getByRole("navigation", { name: "Build panels" });
for (const label of ["Task", "Steps", "Changes", "Files", "Terminal", "Preview", "Status"]) {
  try {
    await nav.getByRole("button", { name: label, exact: true }).click();
    await page.waitForTimeout(350);
    const heading = (await page.getByRole("heading", { level: 3 }).last().textContent())?.trim();
    report.panels.push({ label, heading });
  } catch (error) {
    report.failures.push(`${label}: ${error instanceof Error ? error.message : error}`);
  }
}
await nav.getByRole("button", { name: "Files", exact: true }).click();
const tree = page.getByRole("treeitem");
const count = await tree.count();
report.tools.push({ files: count });
if (count) {
  await tree.first().click();
  report.tools.push({ opened: await tree.first().getAttribute("aria-selected"), name: (await tree.first().textContent())?.trim() });
  for (const label of ["Complete", "Debug"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    const enabled = await button.isEnabled();
    if (!enabled) {
      report.tools.push({ label, enabled });
      continue;
    }
    await button.click();
    await page.waitForTimeout(1200);
    const notice = (await page.locator("[data-testid='debug-pause'], [data-testid='completions'], .code-ide-results, .code-ide-empty").last().textContent().catch(() => ""))?.trim();
    report.tools.push({ label, enabled, notice: notice?.slice(0, 180) });
  }
  const close = page.getByRole("button", { name: /^Close / }).first();
  if (await close.count()) {
    await close.click();
    report.tools.push({ label: "Close tab", closed: true });
  }
}
await page.screenshot({ path: `${root}/editor-buttons-phone.png` });
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (report.failures.length) process.exit(1);
