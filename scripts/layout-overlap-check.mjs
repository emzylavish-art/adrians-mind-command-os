#!/usr/bin/env node
/**
 * layout-overlap-check.mjs
 * Opens Adrian's Mind sheets/modals at several viewports and asserts:
 *  - every action button is fully inside the viewport
 *  - elementFromPoint at each button's centre returns that button (not covered)
 *
 * Usage: node scripts/layout-overlap-check.mjs [--base URL] [--shots DIR] [--label after]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = flag("--base", process.env.LAYOUT_CHECK_BASE || "http://127.0.0.1:8080");
const SHOTS = flag("--shots", "/workspace/audit/layout-scatter/shots");
const LABEL = flag("--label", "after");
const ONLY = flag("--only", "");
const VIEWPORTS = [
  { name: "iphone14", width: 390, height: 844, mobile: true },
  { name: "iphoneSE", width: 375, height: 667, mobile: true },
  { name: "iphone14proMax", width: 430, height: 932, mobile: true },
  { name: "desktop", width: 1280, height: 800, mobile: false },
];

mkdirSync(SHOTS, { recursive: true });

function centre(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function fullyInViewport(box, vw, vh) {
  const pad = 0.5;
  return (
    box.x >= -pad &&
    box.y >= -pad &&
    box.x + box.width <= vw + pad &&
    box.y + box.height <= vh + pad &&
    box.width > 0 &&
    box.height > 0
  );
}

async function assertButtonsVisibleUncovered(page, buttons, report, ctx) {
  const vw = page.viewportSize().width;
  const vh = page.viewportSize().height;
  for (const btn of buttons) {
    const handle = await btn.elementHandle();
    if (!handle) {
      report.push({ ...ctx, ok: false, reason: "no element handle" });
      continue;
    }
    const box = await handle.boundingBox();
    if (!box) {
      report.push({ ...ctx, ok: false, reason: "no bounding box (display:none?)" });
      continue;
    }
    const inView = fullyInViewport(box, vw, vh);
    const { x, y } = centre(box);
    const top = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        return {
          tag: el.tagName,
          testid: el.getAttribute("data-testid"),
          text: (el.innerText || el.textContent || "").trim().slice(0, 80),
          aria: el.getAttribute("aria-label"),
        };
      },
      { x, y },
    );
    const ownTestId = await btn.getAttribute("data-testid");
    const ownText = ((await btn.innerText().catch(() => "")) || "").trim().slice(0, 80);
    const coveredOk = await page.evaluate(
      ({ x, y, testId, text }) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return false;
        if (testId && el.closest(`[data-testid="${testId}"]`)) return true;
        // button itself or a descendant
        const btn = el.closest("button");
        if (!btn) return false;
        if (testId && btn.getAttribute("data-testid") === testId) return true;
        if (text && (btn.innerText || "").trim().startsWith(text.slice(0, 12))) return true;
        return btn === el || btn.contains(el);
      },
      { x, y, testId: ownTestId, text: ownText },
    );
    const ok = inView && coveredOk;
    report.push({
      ...ctx,
      ok,
      inView,
      coveredOk,
      box,
      top,
      testId: ownTestId,
      text: ownText,
    });
  }
}

async function closeSheets(page) {
  await page.keyboard.press("Escape").catch(() => {});
  const cancel = page.locator(
    '[data-testid="memory-sheet-cancel"], [data-testid="approval-sheet-deny"], .overlay-panel__actions button:has-text("Cancel"), [data-testid="shortcut-sheet-close"], [data-testid="voice-overlay-close"]',
  );
  const n = await cancel.count();
  for (let i = 0; i < n; i++) {
    await cancel.nth(i).click({ force: true }).catch(() => {});
  }
  await page.waitForTimeout(200);
}

async function runViewport(browser, vp, results) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    userAgent: vp.mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : undefined,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(BASE + "/", { waitUntil: "commit", timeout: 120000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 120000 }).catch(() => {});
  await page.waitForSelector(".shell, [data-workspace-ready], .masthead", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1200);

  // Home
  try { await page.screenshot({ path: join(SHOTS, `${LABEL}-home-${vp.name}.png`), type: "jpeg", quality: 55 }); } catch (e) { console.warn("home shot failed", e.message); }

  // Memory sheet
  await closeSheets(page);
  const memToggle = page.locator('[data-testid="composer-memory-toggle"], button[role="switch"]').filter({ hasText: /Memory/i }).first();
  if (await memToggle.count()) {
    await memToggle.scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(() => {
      const t = document.querySelector('[data-testid="composer-memory-toggle"]');
      if (t instanceof HTMLElement) t.click();
    });
    await page.waitForSelector('[data-testid="action-sheet"], .overlay-panel, [data-testid="memory-sheet-cancel"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(250);
    try { await page.screenshot({ path: join(SHOTS, `${LABEL}-memory-sheet-${vp.name}.png`), type: "jpeg", quality: 55 }); } catch (e) { console.warn("memory shot failed", e.message); }
    const actions = page.locator(
      '[data-testid="memory-sheet-cancel"], [data-testid="memory-sheet-enable"], .overlay-panel__actions button',
    );
    const count = await actions.count();
    const list = [];
    for (let i = 0; i < count; i++) list.push(actions.nth(i));
    await assertButtonsVisibleUncovered(page, list, results, {
      viewport: vp.name,
      sheet: "memory",
    });
  } else {
    results.push({ viewport: vp.name, sheet: "memory", ok: false, reason: "toggle not found" });
  }

  // Project sheet
  await closeSheets(page);
  // Prefer the quick action if visible
  let opened = false;
  const createBtns = page.getByRole("button", { name: /Create Project|Create project/i });
  if (await createBtns.count()) {
    await createBtns.first().click({ force: true }).catch(() => {});
    opened = await page
      .waitForSelector('.overlay-panel:has-text("Create project")', { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }
  if (opened) {
    await page.waitForTimeout(300);
    try { await page.screenshot({ path: join(SHOTS, `${LABEL}-project-sheet-${vp.name}.png`), type: "jpeg", quality: 55 }); } catch (e) { console.warn("project shot failed", e.message); }
    const actions = page.locator(".overlay-panel__actions button");
    const count = await actions.count();
    const list = [];
    for (let i = 0; i < count; i++) list.push(actions.nth(i));
    await assertButtonsVisibleUncovered(page, list, results, {
      viewport: vp.name,
      sheet: "project",
    });
  } else {
    results.push({ viewport: vp.name, sheet: "project", ok: true, skipped: true, reason: "create project control not available" });
  }

  // Shortcut sheet
  await closeSheets(page);
  await page.keyboard.press("?");
  const shortOpen = await page
    .waitForSelector('[data-testid="shortcut-sheet"]', { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (shortOpen) {
    await page.waitForTimeout(300);
    try { await page.screenshot({ path: join(SHOTS, `${LABEL}-shortcut-sheet-${vp.name}.png`), type: "jpeg", quality: 55 }); } catch (e) { console.warn("shortcut shot failed", e.message); }
    const closeBtn = page.locator('[data-testid="shortcut-sheet-close"]');
    try {
      await assertButtonsVisibleUncovered(page, [closeBtn], results, {
        viewport: vp.name,
        sheet: "shortcut",
      });
    } catch (err) {
      results.push({ viewport: vp.name, sheet: "shortcut", ok: false, reason: String(err?.message || err) });
    }
  } else {
    results.push({ viewport: vp.name, sheet: "shortcut", ok: false, reason: "shortcut sheet did not open" });
  }

  await closeSheets(page);
  await context.close();
  console.log(`viewport ${vp.name}: done`);
}

const results = [];
for (const vp of VIEWPORTS.filter((v) => !ONLY || v.name === ONLY)) {
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"] });
  try {
    await runViewport(browser, vp, results);
  } catch (err) {
    results.push({ viewport: vp.name, sheet: "*", ok: false, reason: String(err?.message || err) });
    console.error(`viewport ${vp.name} failed:`, err?.message || err);
  } finally {
    await browser.close().catch(() => {});
  }
}

const failures = results.filter((r) => r.ok === false && !r.skipped);
const summary = {
  base: BASE,
  label: LABEL,
  at: new Date().toISOString(),
  total: results.length,
  failures: failures.length,
  results,
};
writeFileSync(join(SHOTS, `${LABEL}-overlap-report.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ total: summary.total, failures: summary.failures }, null, 2));
if (failures.length) {
  for (const f of failures) {
    console.error("FAIL", f.viewport, f.sheet, f.reason || f.text || f.testId, {
      inView: f.inView,
      coveredOk: f.coveredOk,
      top: f.top,
    });
  }
  process.exit(1);
}
console.log("layout-overlap-check: PASS");
