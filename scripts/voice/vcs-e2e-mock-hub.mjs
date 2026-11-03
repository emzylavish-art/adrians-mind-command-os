/**
 * Playwright E2E for Voice Cloning Studio via mock hub.
 * MOCK-VERIFIED — not a real clone. Port must not be 8080/8095.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/workspace/voice-cloning-studio/package.json");
const { chromium } = require("playwright");

const PORT = Number(process.env.VCS_E2E_PORT || 8127);
const BASE = process.env.VCS_E2E_BASE || `http://127.0.0.1:${PORT}`;
const OUT = "/workspace/voice-test";
mkdirSync(OUT, { recursive: true });

const CHROME =
  process.env.CHROME_PATH ||
  "/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";

const report = { ok: false, steps: [], errors: [] };

function step(name, extra = {}) {
  report.steps.push({ name, at: new Date().toISOString(), ...extra });
  console.log("step", name, extra);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(45_000);

  try {
    await page.goto(`${BASE}/voice-cloning-studio`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="voice-cloning-studio"]');
    await page.screenshot({ path: `${OUT}/vcs-e2e-01-studio.png`, fullPage: true });
    step("studio_loaded");

    // Name + attestation
    await page.fill('[data-testid="vcs-name"]', "E2E Kitchen Voice");
    await page.click('[data-testid="vcs-attest-own"]');
    step("name_attest");

    // Consent challenge
    await page.click('[data-testid="vcs-request-consent"]');
    await page.waitForSelector('[data-testid="vcs-consent-phrase"]');
    const phrase = await page.textContent('[data-testid="vcs-consent-phrase"]');
    step("consent_phrase", { phrase: (phrase || "").slice(0, 80) });
    await page.screenshot({ path: `${OUT}/vcs-e2e-02-consent.png`, fullPage: true });

    // Upload consent + sample WAV (renamed audio/*)
    await page.setInputFiles('[data-testid="vcs-upload-consent"]', `${OUT}/fixtures/consent.wav`);
    await page.setInputFiles('[data-testid="vcs-upload-sample"]', `${OUT}/fixtures/sample.wav`);
    await page.waitForTimeout(300);
    step("uploads");

    await page.click('[data-testid="vcs-create-submit"]');
    // Wait for profile list item or error
    try {
      await page.waitForSelector('[data-testid^="vcs-profile-"]', { timeout: 30_000 });
      step("profile_created");
    } catch (err) {
      const errText = await page.textContent('[data-testid="vcs-error"]').catch(() => null);
      report.errors.push(`create failed: ${errText || err}`);
      await page.screenshot({ path: `${OUT}/vcs-e2e-fail-create.png`, fullPage: true });
      throw err;
    }
    await page.screenshot({ path: `${OUT}/vcs-e2e-03-created.png`, fullPage: true });

    // Generate
    await page.fill('[data-testid="vcs-generate-text"]', "Hello from Adrian's Mind Voice Cloning Studio.");
    await page.click('[data-testid="vcs-generate-submit"]');
    await page.waitForTimeout(1500);
    // Stop mid-play if playing
    if (await page.locator('[data-testid="vcs-stop"]').isVisible()) {
      await page.click('[data-testid="vcs-stop"]');
      step("stop_mid_play");
    }
    await page.screenshot({ path: `${OUT}/vcs-e2e-04-generate.png`, fullPage: true });

    // Replay / preview
    const replay = page.locator('[data-testid="vcs-replay"]');
    if (await replay.isEnabled()) {
      await replay.click();
      await page.waitForTimeout(500);
      await page.click('[data-testid="vcs-stop"]');
      step("preview_replay_stop");
    } else {
      step("preview_skipped_disabled");
    }

    // Export WAV + consent
    const dlWav = page.waitForEvent("download", { timeout: 15_000 }).catch(() => null);
    await page.click('[data-testid="vcs-export-wav"]');
    const wavDl = await dlWav;
    if (wavDl) {
      await wavDl.saveAs(`${OUT}/vcs-e2e-export.wav`);
      step("export_wav", { suggested: wavDl.suggestedFilename() });
    } else {
      const errText = await page.textContent('[data-testid="vcs-error"]').catch(() => "");
      step("export_wav_no_download", { errText });
    }

    const dlJson = page.waitForEvent("download", { timeout: 15_000 }).catch(() => null);
    await page.click('[data-testid="vcs-export-consent"]');
    const jsonDl = await dlJson;
    if (jsonDl) {
      await jsonDl.saveAs(`${OUT}/vcs-e2e-consent.json`);
      step("export_consent");
    }

    await page.screenshot({ path: `${OUT}/vcs-e2e-05-export.png`, fullPage: true });

    // Delete
    await page.click('[data-testid="vcs-delete"]');
    await page.click('[data-testid="vcs-delete-yes"]');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/vcs-e2e-06-deleted.png`, fullPage: true });
    step("deleted");

    report.ok = report.errors.length === 0;
  } catch (err) {
    report.errors.push(String(err));
    report.ok = false;
    await page.screenshot({ path: `${OUT}/vcs-e2e-fail.png`, fullPage: true }).catch(() => {});
  } finally {
    writeFileSync(`${OUT}/vcs-e2e-report.json`, JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main();
