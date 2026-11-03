#!/usr/bin/env node
/**
 * SPV-F2: command palette width at 390×844 and 1440×900.
 * Ctrl/Cmd-K opens, Escape closes. Palette stays inside the viewport.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:8080/";

function placeholderFits(page) {
  return page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Search"]');
    if (!input) return false;
    const cs = getComputedStyle(input);
    const probe = document.createElement("span");
    probe.textContent = input.getAttribute("placeholder") || "";
    probe.style.cssText = `position:absolute;left:-9999px;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing};`;
    document.body.appendChild(probe);
    const textW = probe.getBoundingClientRect().width;
    probe.remove();
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    return input.clientWidth - pad + 1 >= textW;
  });
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const results = {};
  for (const vp of [
    { name: "mobile", width: 390, height: 844, minPalette: 320 },
    { name: "desktop", width: 1440, height: 900, minPalette: 360 },
  ]) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 });
    const palette = page.locator("#command-palette");
    // Shell is server-rendered; the key listener attaches after hydration.
    const deadline = Date.now() + 12000;
    while ((await palette.count()) === 0) {
      if (Date.now() > deadline) break;
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(250);
    }
    await palette.waitFor({ state: "visible", timeout: 4000 });
    const box = await palette.boundingBox();
    assert.ok(box, `${vp.name} palette has no box`);
    assert.ok(box.width + 0.5 >= vp.minPalette, `${vp.name} palette width ${box.width} < ${vp.minPalette}`);
    assert.ok(box.x >= -1, `${vp.name} palette left ${box.x} is outside`);
    assert.ok(box.x + box.width <= vp.width + 1, `${vp.name} palette right ${box.x + box.width} exceeds ${vp.width}`);
    const item = palette.locator("button").first();
    const ibox = await item.boundingBox();
    assert.ok(ibox && ibox.height >= 44 - 0.5, `${vp.name} item height ${ibox?.height}`);
    assert.ok(ibox && ibox.width >= 44, `${vp.name} item width ${ibox?.width}`);
    const wrapped = await item.evaluate((el) => {
      const label = el.querySelector("span");
      if (!label) return true;
      const cs = getComputedStyle(label);
      return cs.whiteSpace !== "nowrap" && label.scrollHeight > label.clientHeight + 2;
    });
    assert.equal(wrapped, false, `${vp.name} palette label wraps per letter`);
    const covered = await item.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !el.contains(top);
    });
    assert.equal(covered, false, `${vp.name} palette item is covered`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `${vp.name} horizontal overflow`);
    if (vp.name === "desktop") {
      assert.equal(await placeholderFits(page), true, "desktop placeholder is clipped");
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    assert.equal(await palette.count(), 0, `${vp.name} Escape did not close the palette`);
    await page.keyboard.press("Control+k");
    await palette.waitFor({ state: "visible", timeout: 4000 });
    results[vp.name] = { width: box.width, height: box.height, x: box.x, itemH: ibox.height, itemW: ibox.width };
    await page.close();
  }
  console.log(JSON.stringify({ ok: true, ...results }));
} finally {
  await browser.close();
}
