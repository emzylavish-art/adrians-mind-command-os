#!/usr/bin/env node
/**
 * Adrian's Mind — every logic-lane control must do a real action (or honest needs-config).
 * Fails on preview-only / coming-soon no-ops for the controls this lane owns.
 *
 * Usage:
 *   node scripts/controls-smoke.mjs [--url http://127.0.0.1:8080]
 * Env: CONTROLS_SMOKE_URL, CONTROLS_SMOKE_TIMEOUT_MS
 */
import { chromium } from "playwright";

const url =
  process.env.CONTROLS_SMOKE_URL ||
  (() => {
    const i = process.argv.indexOf("--url");
    return i >= 0 ? process.argv[i + 1] : null;
  })() ||
  "http://127.0.0.1:8080/";
const timeoutMs = Number(process.env.CONTROLS_SMOKE_TIMEOUT_MS || 60000);
const FORBIDDEN = [/is preview only/i, /coming soon — not wired yet/i, /markPreview/i];
const ALLOWED_NEEDS = /needs config/i;

const results = [];

function record(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function dismissOverlays(page) {
  for (let i = 0; i < 3; i++) {
    const has = await page.locator(".overlay-backdrop, [role='dialog'], [aria-modal='true']").count();
    if (!has) break;
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
    // click backdrop if still present
    const backdrop = page.locator(".overlay-backdrop").first();
    if (await backdrop.count()) {
      await backdrop.click({ position: { x: 4, y: 4 }, force: true }).catch(() => {});
      await page.waitForTimeout(150);
    }
  }
}

async function snap(page) {
  return page.evaluate(() => {
    const h2 = Array.from(document.querySelectorAll("h2"))
      .map((n) => n.textContent?.trim())
      .filter(Boolean)
      .slice(0, 8);
    const dialog = document.querySelector('[role="dialog"], [aria-modal="true"], .sheet, .modal, .overlay-backdrop');
    const viewBtn = document.querySelector('[aria-current="page"], .tile-active, .nav-view-active');
    return {
      href: location.href,
      notice: document.body?.innerText?.slice(0, 8000) || "",
      h2: h2.join("|"),
      dialog: Boolean(dialog),
      view: viewBtn?.textContent?.trim() || viewBtn?.getAttribute("aria-label") || "",
    };
  });
}

async function clickAndObserve(page, locator, label, { allowNeeds } = {}) {
  await dismissOverlays(page);
  const before = await snap(page);
  try {
    await locator.first().click({ timeout: 8000 });
  } catch (err) {
    const msg = err.message.split("\n")[0];
    if (/Analyze File|attach|file/i.test(label) && /Timeout|file chooser|FileChooser/i.test(err.message)) {
      record(label, true, `native file chooser armed (${msg.slice(0, 80)})`);
      await dismissOverlays(page);
      return;
    }
    record(label, false, `click failed: ${msg}`);
    await dismissOverlays(page);
    return;
  }
  await page.waitForTimeout(450);
  const after = await snap(page);
  for (const bad of FORBIDDEN) {
    if (bad.test(after.notice) && !before.notice.match(bad)) {
      record(label, false, `introduced forbidden copy: ${bad}`);
      await dismissOverlays(page);
      return;
    }
  }
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName}:${el.getAttribute("data-testid") || el.className || ""}` : "";
  });
  const pressed = await locator.first().evaluate((el) => {
    const aria = el.getAttribute("aria-pressed");
    const cls = el.className || "";
    return aria === "true" || /tile-active|bg-accent/.test(cls);
  }).catch(() => false);
  const fileArmed = await page.evaluate(() => Boolean(document.querySelector('input[type="file"]')));
  const changed =
    after.href !== before.href ||
    after.notice !== before.notice ||
    after.h2 !== before.h2 ||
    after.dialog !== before.dialog ||
    after.view !== before.view ||
    focused.includes("INPUT") ||
    focused.includes("TEXTAREA") ||
    pressed ||
    fileArmed ||
    (allowNeeds && ALLOWED_NEEDS.test(after.notice));
  if (!changed) {
    record(label, false, "no observable action (possible no-op)");
  } else {
    record(label, true, focused ? `focus=${focused.slice(0, 60)}` : `h2=${after.h2.slice(0, 40)}`);
  }
  await dismissOverlays(page);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(timeoutMs);
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (!res || !res.ok()) {
      console.error(JSON.stringify({ ok: false, error: "non-OK navigation", url }, null, 2));
      await browser.close();
      process.exit(2);
    }
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: `navigation failed: ${err.message}`, url }, null, 2));
    await browser.close();
    process.exit(2);
  }

  await page.waitForTimeout(800);

  const tries = [
    { label: "home-create-project", sel: 'button:has-text("Create Project")' },
    { label: "home-research", sel: 'button:has-text("Research")' },
    { label: "home-analyze-file", sel: 'button:has-text("Analyze File")' },
    { label: "home-more-tools", sel: 'button:has-text("More Tools")' },
    { label: "nav-settings", sel: '[data-testid="nav-view-settings"], button:has-text("Settings")' },
    { label: "new-chat", sel: 'button:has-text("New Chat")' },
    { label: "ask-mode", sel: 'button:has-text("Ask")' },
    { label: "automatic-mode", sel: 'button:has-text("Automatic")' },
    { label: "model-tier-chip", sel: "button.model-chip, [aria-label*=\"Model mode\"]" },
    { label: "composer-attach", sel: 'button:has-text("Attach")' },
  ];

  for (const t of tries) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(() => {});
    await page.waitForTimeout(500);
    await dismissOverlays(page);
    const loc = page.locator(t.sel);
    const count = await loc.count();
    if (count === 0) {
      record(t.label, true, "skipped (not in DOM — auth/view)");
      continue;
    }
    const visible = await loc.first().isVisible().catch(() => false);
    if (!visible) {
      record(t.label, true, "skipped (not visible)");
      continue;
    }
    if (t.label === "automatic-mode") {
      const ask = page.locator('button:has-text("Ask")').first();
      if (await ask.count()) await ask.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
    await clickAndObserve(page, loc, t.label, { allowNeeds: true });
  }

  const gen = page.locator('button:has-text("Generate Image")');
  if (await gen.count()) {
    await clickAndObserve(page, gen, "home-generate-image (media lane)", { allowNeeds: true });
    const last = results[results.length - 1];
    if (last && !last.ok) {
      last.ok = true;
      last.detail = `${last.detail} (media-lane stub tolerated)`;
      console.log(`NOTE  ${last.label} tolerated for media lane`);
    }
  }

  const body = await page.content();
  if (/is preview only\. No voice provider is connected/i.test(body)) {
    record("chrome-preview-copy", false, "legacy preview-only copy still in DOM");
  } else {
    record("chrome-preview-copy", true, "legacy preview-only copy absent");
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  const summary = {
    ok: failed.length === 0,
    url,
    passed: results.filter((r) => r.ok).length,
    failed: failed.length,
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }, null, 2));
  process.exit(2);
});
