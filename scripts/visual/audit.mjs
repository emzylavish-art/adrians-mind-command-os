#!/usr/bin/env node
/**
 * Safe visual regression and accessibility audit.
 *
 * It only opens pages and follows primary navigation. It deliberately never
 * submits forms, starts OAuth, calls an MCP tool, runs Build, or changes data.
 * Start the app separately, then run:
 *   BASE_URL=http://127.0.0.1:8080 npm run visual:audit
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:8080/";
const artifactDir = resolve(process.env.VISUAL_ARTIFACT_DIR ?? "artifacts/visual-audit");
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844, isMobile: true },
];

// These are navigation-only controls. Do not add controls with side effects.
const primaryViews = ["Build", "Intelligence", "Research", "Projects", "Library", "Plugins", "Scheduled"];
const moreViews = ["EVE", "Bots", "Tools", "Skills", "Runs", "Memory", "Activity", "Help"];

mkdirSync(artifactDir, { recursive: true });

function slug(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "");
}

async function layoutProblems(page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const elements = [...document.querySelectorAll("button, a, input, select, textarea, summary, img")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
    const overflow = elements
      .filter((element) => element.getBoundingClientRect().right > width + 1 || element.getBoundingClientRect().left < -1)
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        label: (element.getAttribute("aria-label") || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
      }));
    const smallTargets = elements
      .filter((element) => ["BUTTON", "A", "SUMMARY"].includes(element.tagName))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width < 40 || box.height < 40;
      })
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        label: (element.getAttribute("aria-label") || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
      }));
    return {
      documentOverflow: Math.max(0, document.documentElement.scrollWidth - width),
      overflowingControls: overflow,
      smallTargets,
    };
  });
}

async function auditState(page, viewportName, label, report) {
  await page.waitForTimeout(250);
  const layout = await layoutProblems(page);
  const accessibility = await new AxeBuilder({ page }).analyze();
  const shot = `${viewportName}-${slug(label)}.png`;
  await page.screenshot({ path: resolve(artifactDir, shot), fullPage: false });
  report.states.push({
    viewport: viewportName,
    label,
    screenshot: shot,
    layout,
    axe: {
      violations: accessibility.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.length,
      })),
    },
  });
}

async function openView(page, label, needsMore = false) {
  if (needsMore) {
    const summary = page.locator("aside summary").filter({ hasText: "More" }).first();
    if (await summary.count()) {
      const isOpen = await summary.evaluate((element) => element.parentElement?.hasAttribute("open") ?? false);
      if (!isOpen) await summary.click();
    }
  }
  const button = page.locator("aside").getByRole("button", { name: label, exact: true }).first();
  if (!(await button.count())) throw new Error(`Navigation control not found: ${label}`);
  await button.click();
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const report = { baseUrl, generatedAt: new Date().toISOString(), states: [], failures: [] };

try {
  for (const viewport of viewports) {
    // axe opens an isolated helper page while it evaluates the document, so it
    // requires a BrowserContext rather than browser.newPage().
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.isMobile });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1_000);
    await auditState(page, viewport.name, "Chat home", report);

    for (const label of [...primaryViews, ...moreViews]) {
      try {
        if (viewport.isMobile) {
          const openMenu = page.getByRole("button", { name: "Open menu" });
          if (await openMenu.count()) await openMenu.click();
        }
        await openView(page, label, moreViews.includes(label));
        await auditState(page, viewport.name, label, report);
      } catch (error) {
        report.failures.push({ viewport: viewport.name, label, error: error instanceof Error ? error.message : String(error) });
      }
    }

    try {
      if (viewport.isMobile) {
        const openMenu = page.getByRole("button", { name: "Open menu" });
        if (await openMenu.count()) await openMenu.click();
      }
      await page.locator("aside button[aria-label='Open Settings']").click();
      await auditState(page, viewport.name, "Settings", report);
    } catch (error) {
      report.failures.push({ viewport: viewport.name, label: "Settings", error: error instanceof Error ? error.message : String(error) });
    }
    await context.close();
  }
} finally {
  await browser.close();
}

writeFileSync(resolve(artifactDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ states: report.states.length, failures: report.failures.length, artifactDir }));
if (report.failures.length) process.exitCode = 1;
