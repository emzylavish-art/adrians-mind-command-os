#!/usr/bin/env node
/**
 * Mobile structure check (390×844): no panel overlap + page scrolls to bottom.
 * Targets local guest preview (default http://127.0.0.1:8102/dashboard).
 */
import { chromium } from "playwright";

const BASE = process.env.DASH_PREVIEW_URL || "http://127.0.0.1:8102/dashboard";
const WIDTH = 390;
const HEIGHT = 844;
const SELECTORS = [
  '[data-testid="mobile-card-notion"]',
  '[data-testid="mobile-card-money"]',
  '[data-testid="mobile-card-feed"]',
  '[data-testid="mobile-card-charts"]',
  '[data-testid="mobile-card-mirror"]',
  '[data-testid="mobile-card-compass"]',
  '[data-testid="mobile-card-scene"]',
  '[data-testid="graph-filters-sheet"]',
  '[data-testid="graph-filters"]',
  '[data-testid="feed-panel"]',
  '[data-testid="charts-panel"]',
  '[data-testid="notion-mirror"]',
  '[data-testid="money-panel"]',
  '[data-testid="orientation-minimap"]',
];

function overlaps(a, b) {
  if (!a || !b) return false;
  if (a.width < 2 || a.height < 2 || b.width < 2 || b.height < 2) return false;
  // ignore zero-opacity / invisible
  const noX = a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5;
  const noY = a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;
  return !(noX || noY);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: WIDTH, height: HEIGHT });

let failed = false;
const notes = [];

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="dash3d-root"]', { timeout: 60000 });
  // give status + lazy panels a beat
  await page.waitForTimeout(2500);

  // Filters must be closed by default
  const sheetOpen = await page.locator('[data-testid="graph-filters-sheet"]').count();
  if (sheetOpen > 0) {
    failed = true;
    notes.push("filter sheet open by default");
  } else {
    notes.push("filter sheet closed by default");
  }

  const boxes = [];
  for (const sel of SELECTORS) {
    const loc = page.locator(sel);
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      const box = await el.boundingBox();
      if (!box) continue;
      // Skip zero-size
      if (box.width < 4 || box.height < 4) continue;
      boxes.push({ sel, box, i });
    }
  }

  const hits = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i];
      const B = boxes[j];
      // nested: child inside parent is OK (money inside money-card)
      const aContainsB =
        A.box.x <= B.box.x + 0.5 &&
        A.box.y <= B.box.y + 0.5 &&
        A.box.x + A.box.width >= B.box.x + B.box.width - 0.5 &&
        A.box.y + A.box.height >= B.box.y + B.box.height - 0.5;
      const bContainsA =
        B.box.x <= A.box.x + 0.5 &&
        B.box.y <= A.box.y + 0.5 &&
        B.box.x + B.box.width >= A.box.x + A.box.width - 0.5 &&
        B.box.y + B.box.height >= A.box.y + A.box.height - 0.5;
      if (aContainsB || bContainsA) continue;
      // ignore filter dock if hidden via CSS
      if (overlaps(A.box, B.box)) {
        hits.push(`${A.sel}#${A.i} ∩ ${B.sel}#${B.i}`);
      }
    }
  }

  if (hits.length) {
    failed = true;
    notes.push(`overlap: ${hits.slice(0, 12).join("; ")}`);
  } else {
    notes.push(`no overlap among ${boxes.length} visible boxes`);
  }

  // Scroll to bottom
  const before = await page.evaluate(() => ({
    top: document.scrollingElement?.scrollTop ?? 0,
    sh: document.scrollingElement?.scrollHeight ?? 0,
    ch: document.scrollingElement?.clientHeight ?? 0,
  }));
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="dash3d-root"]');
    if (root) root.scrollTop = root.scrollHeight;
    if (document.scrollingElement) document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
  });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="dash3d-root"]');
    const se = document.scrollingElement;
    return {
      rootTop: root?.scrollTop ?? 0,
      rootSh: root?.scrollHeight ?? 0,
      rootCh: root?.clientHeight ?? 0,
      seTop: se?.scrollTop ?? 0,
      seSh: se?.scrollHeight ?? 0,
      seCh: se?.clientHeight ?? 0,
    };
  });
  const rootScrollable = after.rootSh > after.rootCh + 20;
  const seScrollable = after.seSh > after.seCh + 20;
  const scrolled =
    (rootScrollable && after.rootTop > 40) ||
    (seScrollable && after.seTop > 40) ||
    (!rootScrollable && !seScrollable); // short content: vacuously OK
  if (!scrolled) {
    failed = true;
    notes.push(`scroll failed before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  } else {
    notes.push(`scroll ok rootTop=${after.rootTop} seTop=${after.seTop} rootSh=${after.rootSh}`);
  }

  // Section nav present
  const nav = await page.locator('[data-testid="mobile-section-nav"]').count();
  if (nav < 1) {
    failed = true;
    notes.push("missing mobile-section-nav");
  } else {
    notes.push("section nav present");
  }
} catch (err) {
  failed = true;
  notes.push(`error: ${err?.message || err}`);
} finally {
  await browser.close();
}

const line = `[dashboard-mobile-overlap] ${failed ? "FAIL" : "PASS"} ${notes.join(" | ")}`;
console.log(line);
process.exit(failed ? 1 : 0);
