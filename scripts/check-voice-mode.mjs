#!/usr/bin/env node
/**
 * SPV-F4: exactly one visible voice-mode control, inside the viewport,
 * on Chat, Projects, and Thread, at 390×844 and 1440×900, in Direct and
 * Orchestrator. The control does not show a raw loopback host.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:8080/";

function controls(page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll("button")].filter((b) =>
      (b.getAttribute("aria-label") || "").startsWith("Switch voice mode"),
    );
    return nodes.map((b) => {
      const r = b.getBoundingClientRect();
      const s = getComputedStyle(b);
      const badge = b.closest("[data-testid^='voice-mode-badge']");
      const br = badge?.getBoundingClientRect();
      const visible = s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
      return {
        label: b.getAttribute("aria-label"),
        visible,
        l: r.left,
        t: r.top,
        r: r.right,
        b: r.bottom,
        badgeText: badge?.innerText || "",
        badge: br
          ? { l: br.left, t: br.top, r: br.right, b: br.bottom, w: br.width, h: br.height }
          : null,
      };
    });
  });
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const summary = {};
  for (const vp of [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1440, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector('button[aria-label^="Switch voice mode"]', { timeout: 15000 });
    summary[vp.name] = {};
    for (const view of ["Chat", "Projects", "Thread"]) {
      await page.evaluate((label) => {
        const btn = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label);
        btn?.click();
      }, view);
      await page.waitForTimeout(200);
      for (const mode of ["direct", "orchestrator"]) {
        const toggle = page.locator('[data-testid="voice-mode-toggle-header"]');
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const label = (await toggle.getAttribute("aria-label")) || "";
          const isOrch = label.includes("currently Orchestrator");
          if ((mode === "orchestrator") === isOrch) break;
          await toggle.click();
          await page.waitForTimeout(200);
        }
        const landed = (await toggle.getAttribute("aria-label")) || "";
        assert.equal(landed.includes("currently Orchestrator"), mode === "orchestrator", landed);
        if (mode === "orchestrator") {
          const text = await page.locator('[data-testid="voice-mode-badge-header"]').innerText();
          assert.match(text, /paired computer/i);
          assert.doesNotMatch(text, /127\.0\.0\.1|localhost:\d+/);
        }
        const found = await controls(page);
        const visible = found.filter((c) => c.visible);
        assert.equal(visible.length, 1, `${vp.name} ${view} ${mode} visible controls ${visible.length}`);
        const box = visible[0].badge || visible[0];
        assert.ok(box.l >= -1 && box.t >= -1, `${vp.name} ${view} ${mode} starts outside ${box.l},${box.t}`);
        assert.ok(box.r <= vp.width + 1, `${vp.name} ${view} ${mode} right ${box.r} > ${vp.width}`);
        assert.ok(box.b <= vp.height + 1, `${vp.name} ${view} ${mode} bottom ${box.b} > ${vp.height}`);
        assert.equal(/127\.0\.0\.1|localhost:\d+/.test(visible[0].badgeText), false, visible[0].badgeText);
        summary[vp.name][`${view}-${mode}`] = { n: visible.length, r: Math.round(box.r), b: Math.round(box.b) };
      }
    }
    await page.close();
  }
  console.log(JSON.stringify({ ok: true, summary }));
} finally {
  await browser.close();
}
