#!/usr/bin/env node
/**
 * Safe visual regression and accessibility audit.
 *
 * The navigation sweep only opens pages. Optional functional fixtures run in
 * fresh local contexts whose API/RPC traffic is intercepted and external traffic blocked.
 * Neither mode starts OAuth, invokes live tools/providers or writes account data.
 * Start the app separately, then run:
 *   BASE_URL=http://127.0.0.1:8080 npm run visual:audit
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { evaluateVisualReport } from "./policy.mjs";
import { VISUAL_DESTINATIONS, verifyDestination } from "./destinations.mjs";
import { fixtureRequestDecision, installVisualFixture, VISUAL_FIXTURES } from "./fixture-states.mjs";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import { isolateWorkspace } from "./isolate-workspace.mjs";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:8080/";
const artifactDir = resolve(process.env.VISUAL_ARTIFACT_DIR ?? "artifacts/visual-audit");
const mode = process.env.VISUAL_AUDIT_MODE || "report";
if (!["report", "release"].includes(mode)) throw new Error("VISUAL_AUDIT_MODE must be report or release.");
const policy = JSON.parse(readFileSync(resolve(process.env.VISUAL_POLICY || "docs/verification/visual-policy.json"), "utf8"));
const baseline = process.env.VISUAL_BASELINE ? JSON.parse(readFileSync(resolve(process.env.VISUAL_BASELINE), "utf8")) : null;
const fixtureOnly = process.argv.includes("--fixture-only") || process.env.VISUAL_FIXTURE_ONLY === "1";
const requestedFixtures = (process.env.VISUAL_FIXTURE_STATES || (fixtureOnly ? Object.keys(VISUAL_FIXTURES).join(",") : "")).split(",").map((value) => value.trim()).filter(Boolean);
if (requestedFixtures.some((name) => !VISUAL_FIXTURES[name])) throw new Error("Unknown visual fixture state.");
if (requestedFixtures.length) fixtureRequestDecision(baseUrl, baseUrl, "GET");
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim());
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844, isMobile: true },
];
const themes = ["dark", "light"];

// These are navigation-only controls. Do not add controls with side effects.
const primaryViews = VISUAL_DESTINATIONS.filter((item) => !item.more && !["Chat home", "Chat fixture", "Settings"].includes(item.label)).map((item) => item.label);
const moreViews = VISUAL_DESTINATIONS.filter((item) => item.more).map((item) => item.label);

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
        return box.width > 0
          && box.height > 0
          && style.visibility !== "hidden"
          && style.display !== "none"
          && !element.classList.contains("sr-only")
          && element.getAttribute("aria-hidden") !== "true";
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

async function auditState(page, viewportName, theme, label, report, fixtureName) {
  const destination = await verifyDestination(page, VISUAL_DESTINATIONS.find((item) => item.label === label));
  const actualTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (actualTheme !== theme) throw new Error(`Expected ${theme} theme, observed ${actualTheme || "unset"}.`);
  const layout = await layoutProblems(page);
  const buildStyleSnapshot = () => {
    let node = document.querySelector(".code-ide-status > button:first-child");
    const rows = [];
    for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
      const style = getComputedStyle(node);
      rows.push({ tag: node.tagName, className: node.className, disabled: node.disabled ?? null, color: style.color, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, opacity: style.opacity, filter: style.filter, transition: style.transition });
    }
    return rows;
  };
  const beforeAccessibility = await page.evaluate(buildStyleSnapshot);
  const accessibility = await new AxeBuilder({ page }).analyze();
  const afterAccessibility = await page.evaluate(buildStyleSnapshot);
  const shot = fixtureName ? `${viewportName}-fixture-${slug(fixtureName)}.png` : `${viewportName}-${theme}-${slug(label)}.png`;
  await page.screenshot({ path: resolve(artifactDir, shot), fullPage: false });
  report.states.push({
    viewport: viewportName,
    theme,
    label,
    screenshot: shot,
    destination,
    layout,
    axe: {
      violations: accessibility.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.length,
        targets: violation.nodes.map((node) => node.target),
        details: violation.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })),
      })),
    },
    ...(beforeAccessibility.length ? { diagnostics: { buildSaveStyle: { beforeAccessibility, afterAccessibility } } } : {}),
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

const report = { schemaVersion: 1, baseUrl, generatedAt: new Date().toISOString(), revision, dirty, mode, fixtureOnly, environment: { engine: "chromium", version: null, mobile: "emulated viewport, not a physical device", authentication: fixtureOnly ? "synthetic fixture identity; no live account" : "not independently verified", serviceWorkers: "blocked" }, states: [], failures: [] };
let browser = null;
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  report.environment.version = browser.version();
} catch (error) {
  report.failures.push({ viewport: "startup", theme: "unknown", label: "Browser unavailable", error: (error instanceof Error ? error.message : String(error)).slice(0, 4000) });
}

if (browser) {
try {
  for (const viewport of viewports) {
    if (!fixtureOnly) {
    // axe opens an isolated helper page while it evaluates the document, so it
    // requires a BrowserContext rather than browser.newPage().
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.isMobile, serviceWorkers: "block" });
    if (["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname)) await isolateWorkspace(context, baseUrl);
    for (const theme of themes) {
      const page = await context.newPage();
      // Seed the app's persisted theme before React mounts. Mutating only the
      // data attribute after mount can be overwritten by the theme effect and
      // produces false light-mode failures on route changes.
      await page.addInitScript((nextTheme) => {
        window.localStorage.setItem("amcos.theme.v1", nextTheme);
      }, theme);
      await page.goto(new URL("/?section=command", baseUrl).href, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.evaluate((nextTheme) => { document.documentElement.dataset.theme = nextTheme; }, theme);
      await auditState(page, viewport.name, theme, "Chat home", report);

      for (const label of [...primaryViews, ...moreViews]) {
        try {
          if (viewport.isMobile) {
            const openMenu = page.getByRole("button", { name: "Open menu" });
            if (await openMenu.count()) await openMenu.click();
          }
          await openView(page, label, moreViews.includes(label));
          await auditState(page, viewport.name, theme, label, report);
        } catch (error) {
          report.failures.push({ viewport: viewport.name, theme, label, error: error instanceof Error ? error.message : String(error) });
        }
      }

      try {
        if (viewport.isMobile) {
          const openMenu = page.getByRole("button", { name: "Open menu" });
          if (await openMenu.count()) await openMenu.click();
        }
        await page.locator("aside button[aria-label='Open Settings']").click();
        await auditState(page, viewport.name, theme, "Settings", report);
      } catch (error) {
        report.failures.push({ viewport: viewport.name, theme, label: "Settings", error: error instanceof Error ? error.message : String(error) });
      }
      await page.close();
    }
    await context.close();
    }
    for (const fixtureName of requestedFixtures) {
      const fixtureContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.isMobile, serviceWorkers: "block" });
      const fixture = VISUAL_FIXTURES[fixtureName];
      const transport = await installVisualFixture(fixtureContext, baseUrl, fixtureName);
      const page = await fixtureContext.newPage();
      const browserErrors = [];
      page.on("pageerror", (error) => browserErrors.push(error.stack || error.message));
      page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
      try {
        await page.addInitScript(() => window.localStorage.setItem("amcos.theme.v1", "dark"));
        await page.goto(new URL(fixture.path, baseUrl).href, { waitUntil: "domcontentloaded" });
        if (fixture.action) await fixture.action(page);
        await page.getByText(fixture.expectedText, { exact: false }).filter({ visible: true }).first().waitFor({ state: "visible", timeout: 15_000 });
        await auditState(page, viewport.name, "dark", fixture.destination, report, fixtureName);
        const captured = report.states.at(-1);
        captured.fixture = { id: fixtureName, synthetic: true, transport: transport.summary() };
      } catch (error) {
        const shot = `${viewport.name}-fixture-${slug(fixtureName)}-failed.png`;
        await page.screenshot({ path: resolve(artifactDir, shot), fullPage: false }).catch(() => {});
        report.failures.push({ viewport: viewport.name, theme: "dark", label: fixtureName, screenshot: shot, browserErrors: browserErrors.slice(0, 10), error: error instanceof Error ? error.message : String(error) });
      }
      finally { await fixtureContext.close(); }
    }
  }
} catch (error) {
  report.failures.push({ viewport: "startup", theme: "unknown", label: "Navigation sweep", error: error instanceof Error ? error.message : String(error) });
} finally {
  await browser.close();
}
}

report.evaluation = evaluateVisualReport(report, { policy, baseline, mode });
writeFileSync(resolve(artifactDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ mode, states: report.states.length, failures: report.failures.length, releaseEligible: report.evaluation.releaseEligible, blocking: report.evaluation.blocking.length, artifactDir }));
process.exitCode = report.evaluation.exitCode;
