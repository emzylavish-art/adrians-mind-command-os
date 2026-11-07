#!/usr/bin/env node
/**
 * SPV-F1b: mobile composer clears a 52px and a 78px primary nav,
 * with at least 8px between the bar and the New chat control.
 * Desktop bottom offset stays the shared 24px.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:8080/";

async function overlaps(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Primary"]');
    const plus = nav?.querySelector('button[aria-label="New chat"]');
    const bar = document.querySelector(".composer-bar.is-fixed");
    const box = (el) => (el ? el.getBoundingClientRect() : null);
    const nb = box(nav);
    const pb = box(plus);
    const bb = box(bar);
    const overlap = (a, b) => {
      if (!a || !b) return 0;
      const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      return x > 0 ? y : 0;
    };
    return {
      navH: nb ? Math.round(nb.height) : 0,
      overlapNav: overlap(nb, bb),
      overlapPlus: overlap(pb, bb),
      gapPlus: pb && bb ? pb.top - bb.bottom : null,
      barBottom: bar ? getComputedStyle(bar).bottom : null,
      clearance: document.documentElement.style.getPropertyValue("--spv-f1-clearance").trim(),
    };
  });
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 });
  await mobile.waitForSelector(".composer-bar.is-fixed", { timeout: 15000 });
  await mobile.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--spv-f1-clearance").trim() !== "",
    { timeout: 8000 },
  );
  const forced = {};
  for (const height of [52, 78]) {
    const before = await mobile.evaluate(
      () => document.documentElement.style.getPropertyValue("--spv-f1-clearance"),
    );
    await mobile.evaluate((h) => {
      const nav = document.querySelector('nav[aria-label="Primary"]');
      nav.style.setProperty("height", `${h}px`, "important");
      nav.style.setProperty("min-height", `${h}px`, "important");
      nav.style.setProperty("max-height", `${h}px`, "important");
    }, height);
    await mobile.waitForFunction(
      (prev) => document.documentElement.style.getPropertyValue("--spv-f1-clearance") !== prev,
      before,
      { timeout: 2000 },
    ).catch(() => {});
    const m = await overlaps(mobile);
    assert.equal(m.overlapNav, 0, `nav ${height}px overlaps bar by ${m.overlapNav}`);
    assert.equal(m.overlapPlus, 0, `nav ${height}px New chat overlaps bar by ${m.overlapPlus}`);
    assert.ok(m.gapPlus >= 8 - 0.5, `nav ${height}px gap to New chat is ${m.gapPlus}`);
    forced[height] = m;
  }

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 });
  await desktop.waitForSelector(".composer-bar.is-fixed", { timeout: 15000 });
  await desktop.waitForTimeout(200);
  const desk = await overlaps(desktop);
  assert.equal(desk.barBottom, "24px", `desktop composer bottom changed to ${desk.barBottom}`);

  console.log(JSON.stringify({ ok: true, forced, desktop: desk }));
} finally {
  await browser.close();
}
