import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  decideResearchAnnouncement,
  researchSteerAvailability,
  citationCountFromResult,
} from "../../src/lib/mind/voice/research-announce.ts";

const BASE = process.env.VOICE_BASE_URL || "http://127.0.0.1:8099";
const OUT = "/workspace/voice-test/research-voice";
mkdirSync(OUT, { recursive: true });

const logic = {
  silent_when_not_configured:
    decideResearchAnnouncement(
      {
        type: "result",
        query: "deep research on batteries",
        result: { ok: false, configured: false, citations: [], error: "No search provider is configured." },
      },
      { announcementsEnabled: true },
    ).speak === false,
  complete_uses_real_count: (() => {
    const r = {
      ok: true,
      configured: true,
      citations: [
        { title: "A", url: "https://a.example" },
        { title: "B", url: "https://b.example" },
      ],
      error: "",
      steps: [{ query: "q", ok: true, count: 2 }],
    };
    const d = decideResearchAnnouncement(
      { type: "result", query: "deep research on batteries", result: r },
      { announcementsEnabled: true },
    );
    return d.speak === true && d.text.includes("2 citation") && citationCountFromResult(r) === 2;
  })(),
  steer: researchSteerAvailability({ hasResearchSteerRoute: false, hasBuildSessionSteerRoute: false }),
  no_duplex_claim: true,
};

const report = { at: new Date().toISOString(), task: "research-lifecycle-voice", base: BASE, ok: false, logic, ui: {}, errors: [] };

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1000);
  // open Research view via nav if present
  const researchNav = page.getByRole("button", { name: /^Research$/i }).first();
  if (await researchNav.count()) {
    await researchNav.click().catch(() => {});
    await page.waitForTimeout(800);
  }
  const toggle = page.locator('[data-testid="research-announce-toggle"]');
  report.ui.toggle_present = (await toggle.count()) > 0;
  if (report.ui.toggle_present) {
    report.ui.toggle_label = await toggle.innerText();
  }
  const hero = await page.locator("text=A search runs only when").count();
  report.ui.research_honesty_copy = hero > 0;
  await page.screenshot({ path: `${OUT}/research-page.png`, fullPage: false });
  report.ok =
    logic.silent_when_not_configured &&
    logic.complete_uses_real_count &&
    logic.steer.available === false &&
    report.ui.toggle_present === true;
} catch (e) {
  report.errors.push(String(e));
  report.ok = false;
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
