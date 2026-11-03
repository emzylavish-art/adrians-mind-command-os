#!/usr/bin/env node
/**
 * SPV-N1: at 390×844, Open menu must reveal the Dashboard route link
 * with a non-zero box (min-height 2.75rem). Desktop sidebar link stays
 * in the rail and does not depend on the mobile drawer.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:8080/";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 });
  const openMenu = mobile.getByRole("button", { name: "Open menu" });
  await openMenu.waitFor({ state: "visible", timeout: 15000 });
  // The shell is server-rendered. Clicks before hydration do not set navOpen.
  const drawer = mobile.locator("aside.rail.nav-drawer-open");
  const deadline = Date.now() + 15000;
  while ((await drawer.count()) === 0) {
    if (Date.now() > deadline) throw new Error("Open menu did not open the drawer");
    await openMenu.click({ timeout: 2000 }).catch(() => {});
    await mobile.waitForTimeout(200);
  }
  const link = mobile.getByTestId("nav-route-dashboard");
  await link.waitFor({ state: "visible", timeout: 10000 });
  const box = await link.boundingBox();
  assert.ok(box, "Dashboard link has no box after Open menu");
  assert.ok(box.width > 0 && box.height > 0, `Dashboard link box is ${box.width}×${box.height}`);
  assert.ok(box.height >= 44 - 0.5, `expected min-height 2.75rem (44px), got ${box.height}`);
  const hit = await link.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el.contains(top);
  });
  assert.equal(hit, true, "Dashboard link center is covered");

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 });
  const desk = desktop.getByTestId("nav-route-dashboard");
  await desk.waitFor({ state: "visible", timeout: 10000 });
  const dbox = await desk.boundingBox();
  assert.ok(dbox && dbox.width > 0 && dbox.height > 0, "desktop Dashboard link has no box");
  assert.ok(dbox.width < 420, `desktop Dashboard link escaped the sidebar (${dbox.width}px)`);
  assert.ok(dbox.height >= 44 - 0.5, `desktop Dashboard link height changed (${dbox.height})`);

  console.log(JSON.stringify({ ok: true, mobile: box, desktop: dbox }));
} finally {
  await browser.close();
}
