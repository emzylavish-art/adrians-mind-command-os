import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = "/workspace/audit/mind-os/memory-ux";
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:8101";
fs.mkdirSync(OUT, { recursive: true });

const viewports = [
  { name: "desktop-1280x800", width: 1280, height: 800 },
  { name: "mobile-390x844", width: 390, height: 844 },
];

const report = { base: BASE, runs: [] };

const browser = await chromium.launch({ headless: true });
try {
  for (const vp of viewports) {
    const consoleErrors = [];
    const pageErrors = [];
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const url = `${BASE}/memory`;
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(600);

    // Clear workspace for honest empty state
    await page.evaluate(() => {
      try {
        localStorage.removeItem("amcos.workspace.v1");
        localStorage.removeItem("amcos.chats.v1");
      } catch {}
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const hasManager = await page.locator('[data-testid="memory-manager"]').count();
    const emptyBefore = await page.locator('[data-testid="memory-empty"]').count();
    const emptyShot = path.join(OUT, `${vp.name}-memory-empty.png`);
    await page.screenshot({ path: emptyShot, fullPage: true });

    // Add via existing path (manager Save note)
    const noteText = vp.name.startsWith("desktop")
      ? 'Pier depth is 12 feet <script>alert(1)</script> 🌊'
      : "Mobile note unicode π";
    await page.locator('[data-testid="memory-draft"]').fill(noteText);
    await page.locator('[data-testid="memory-add"]').click();
    await page.waitForTimeout(400);
    const rowsAfterAdd = await page.locator('[data-testid="memory-row"]').count();
    const indicator = await page.locator('[data-testid="memory-saved-indicator"]').count();
    const displayed = await page.locator('[data-testid="memory-text"]').first().innerText();

    // Edit
    await page.locator('[data-testid="memory-edit"]').first().click();
    await page.locator('[data-testid="memory-edit-text"]').fill(noteText + " (edited)");
    await page.locator('[data-testid="memory-save-edit"]').click();
    await page.waitForTimeout(300);
    const afterEdit = await page.locator('[data-testid="memory-text"]').first().innerText();

    const populatedShot = path.join(OUT, `${vp.name}-memory-populated.png`);
    await page.screenshot({ path: populatedShot, fullPage: true });

    // Delete
    await page.locator('[data-testid="memory-delete"]').first().click();
    await page.waitForTimeout(300);
    const rowsAfterDelete = await page.locator('[data-testid="memory-row"]').count();
    const emptyAfterDelete = await page.locator('[data-testid="memory-empty"]').count();

    // Re-add and reload for persistence
    await page.locator('[data-testid="memory-draft"]').fill("Persist me across reload");
    await page.locator('[data-testid="memory-add"]').click();
    await page.waitForTimeout(600); // localStorage debounce 250ms
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const persistedText = await page.locator('[data-testid="memory-text"]').first().innerText().catch(() => "");
    const rowsAfterReload = await page.locator('[data-testid="memory-row"]').count();
    const persistShot = path.join(OUT, `${vp.name}-memory-persisted.png`);
    await page.screenshot({ path: persistShot, fullPage: true });

    report.runs.push({
      viewport: vp.name,
      status: response?.status() ?? null,
      hasManager,
      emptyBefore,
      rowsAfterAdd,
      indicator,
      displayed,
      afterEdit,
      rowsAfterDelete,
      emptyAfterDelete,
      rowsAfterReload,
      persistedText,
      scriptEscapedAsText: displayed.includes("<script>") && !displayed.toLowerCase().includes("[object"),
      consoleErrors,
      pageErrors,
      screenshots: [emptyShot, populatedShot, persistShot],
    });
    await context.close();
  }
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(OUT, "smoke.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
const bad = report.runs.some(
  (r) =>
    (r.consoleErrors?.length || 0) + (r.pageErrors?.length || 0) > 0 ||
    r.hasManager < 1 ||
    r.emptyBefore < 1 ||
    r.rowsAfterAdd < 1 ||
    r.rowsAfterDelete !== 0 ||
    r.rowsAfterReload < 1 ||
    !String(r.persistedText).includes("Persist me"),
);
process.exit(bad ? 1 : 0);
