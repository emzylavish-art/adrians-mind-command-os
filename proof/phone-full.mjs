import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const root = "/home/ubuntu/adrians-mind-command-os/proof/phone";
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const report = { views: [], installer: {}, failures: [] };

async function expand() {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("html, body, .main-stage, .page-shell")) {
      el.style.height = "auto";
      el.style.maxHeight = "none";
      el.style.overflow = "visible";
    }
  });
}

async function shot(name) {
  await expand();
  await page.screenshot({ path: `${root}/${name}.png`, fullPage: true });
  const title = (await page.locator(".surface-switch__button span").first().textContent())?.trim();
  report.views.push({ name, title });
}

async function openDrawer(label) {
  await page.getByRole("button", { name: "Open menu" }).click();
  const more = page.locator("summary", { hasText: "More" });
  if (await more.count()) {
    const button = page.getByRole("button", { name: label, exact: true });
    if (!(await button.count())) await more.click();
  }
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForTimeout(350);
}

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(500);
await shot("chat");

for (const label of ["Build", "Intelligence", "Research", "Projects", "Library", "Plugins", "Scheduled"]) {
  try {
    await openDrawer(label);
    await shot(label.toLowerCase());
  } catch (error) {
    report.failures.push(`${label}: ${error instanceof Error ? error.message : error}`);
  }
}

try {
  await page.getByTestId("windows-installer-ready").waitFor({ timeout: 8000 });
  report.installer.text = (await page.getByTestId("windows-installer-ready").textContent())?.trim();
  report.installer.href = await page.getByTestId("download-installer").getAttribute("href");
  report.installer.mouseDisabled = await page.getByTestId("desktop-run-mouse").isDisabled();
  report.installer.hostedRunDisabled = await page.getByTestId("run-file_read").isDisabled();
  const response = await page.request.get("http://127.0.0.1:8080/downloads/AdriansMind-Setup.exe");
  report.installer.status = response.status();
  report.installer.bytes = (await response.body()).byteLength;
  await shot("build-installer");
} catch (error) {
  report.failures.push(`Installer UI: ${error instanceof Error ? error.message : error}`);
}

try {
  await openDrawer("Research");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await shot("research-preferences");
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await shot("research-saved");
} catch (error) {
  report.failures.push(`Research groups: ${error instanceof Error ? error.message : error}`);
}

try {
  await openDrawer("More").catch(() => undefined);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.locator("summary", { hasText: "More" }).click();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.getByRole("button", { name: "Not installed", exact: true }).click();
  await shot("skills-missing");
  await page.getByRole("button", { name: "Installed", exact: true }).click();
  await shot("skills-installed");
} catch (error) {
  report.failures.push(`Skills: ${error instanceof Error ? error.message : error}`);
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
if (report.failures.length || report.installer.mouseDisabled !== true || report.installer.status !== 200) process.exit(1);
