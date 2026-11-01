/**
 * Headless Chromium round-trip against the local voice-integration preview.
 * Uses fake media devices + ?voiceTestAudio=hello (dev-only pipeline).
 */
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE = process.env.VOICE_BASE_URL || "http://127.0.0.1:8091";
const URL = `${BASE}/?voiceTestAudio=hello`;
const OUT = process.env.VOICE_ROUNDTRIP_OUT || "/workspace/voice-test/browser-roundtrip.json";
const CHROME =
  process.env.CHROME_PATH ||
  "/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";

const report = {
  at: new Date().toISOString(),
  url: URL,
  ok: false,
  stages: [],
  transcript: null,
  speakingSeen: false,
  interruptResult: null,
  errors: [],
  console: [],
  finalStatus: null,
  finalPhase: null,
};

function pushStage(label, extra = {}) {
  report.stages.push({ t: Date.now(), label, ...extra });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-web-security",
  ],
});

const context = await browser.newContext({
  permissions: ["microphone"],
});
await context.grantPermissions(["microphone"], { origin: BASE });
const page = await context.newPage();
page.on("console", (msg) => {
  report.console.push({ type: msg.type(), text: msg.text() });
});
page.on("pageerror", (err) => {
  report.errors.push(String(err));
});

try {
  pushStage("goto");
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector('[data-testid="voice-overlay-open"]', { timeout: 30000 });
  pushStage("open_overlay_click");
  await page.click('[data-testid="voice-overlay-open"]');
  await page.waitForSelector('[data-testid="voice-overlay"]', { timeout: 10000 });

  // Poll status until listening / error / timeout
  const deadline = Date.now() + 45000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const status = await page.locator('[data-testid="voice-overlay-status"]').innerText().catch(() => "");
    const phase = await page.locator('[data-testid="voice-overlay"]').getAttribute("data-voice-phase").catch(() => null);
    const err = await page.locator('[data-testid="voice-overlay-error"]').innerText().catch(() => null);
    if (status && status !== lastStatus) {
      pushStage("status", { status, phase, err });
      lastStatus = status;
    }
    if (err && (phase === "error" || /Connection failed/i.test(status))) {
      report.errors.push(err);
      report.finalStatus = status;
      report.finalPhase = phase;
      break;
    }
    if (err && !report.errors.includes(err)) report.errors.push(err);
    if (/Listening/i.test(status)) {
      report.finalStatus = status;
      report.finalPhase = phase;
      break;
    }
    await page.waitForTimeout(250);
  }

  // Wait for transcript from test WAV
  const transcriptDeadline = Date.now() + 30000;
  while (Date.now() < transcriptDeadline) {
    const t = await page.locator('[data-testid="voice-overlay-transcript"]').innerText().catch(() => "");
    if (t && t.trim()) {
      report.transcript = t.trim();
      pushStage("transcript", { text: report.transcript });
      break;
    }
    const status = await page.locator('[data-testid="voice-overlay-status"]').innerText().catch(() => "");
    if (/Speaking/i.test(status)) {
      report.speakingSeen = true;
      pushStage("speaking_before_transcript", { status });
      break;
    }
    await page.waitForTimeout(300);
  }

  // Wait for Speaking
  const speakDeadline = Date.now() + 25000;
  while (Date.now() < speakDeadline) {
    const status = await page.locator('[data-testid="voice-overlay-status"]').innerText().catch(() => "");
    if (/Speaking/i.test(status)) {
      report.speakingSeen = true;
      pushStage("speaking", { status });
      break;
    }
    await page.waitForTimeout(250);
  }

  if (report.speakingSeen) {
    const interruptVisible = await page.locator('[data-testid="voice-interrupt"]').isVisible().catch(() => false);
    if (interruptVisible) {
      await page.click('[data-testid="voice-interrupt"]');
      await page.waitForTimeout(500);
      const status = await page.locator('[data-testid="voice-overlay-status"]').innerText().catch(() => "");
      const phase = await page.locator('[data-testid="voice-overlay"]').getAttribute("data-voice-phase").catch(() => null);
      report.interruptResult = { status, phase };
      pushStage("interrupt", report.interruptResult);
    } else {
      report.interruptResult = { error: "voice-interrupt not visible" };
    }
  }

  report.finalStatus =
    report.finalStatus ||
    (await page.locator('[data-testid="voice-overlay-status"]').innerText().catch(() => null));
  report.finalPhase =
    report.finalPhase ||
    (await page.locator('[data-testid="voice-overlay"]').getAttribute("data-voice-phase").catch(() => null));

  report.ok = Boolean(
    report.stages.some((s) => /Listening/i.test(s.status || "")) &&
      (report.transcript || report.speakingSeen),
  );
} catch (err) {
  report.errors.push(String(err));
} finally {
  await browser.close();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, out: OUT, stages: report.stages.map((s) => s.label + (s.status ? `:${s.status}` : "")), transcript: report.transcript, speakingSeen: report.speakingSeen, interruptResult: report.interruptResult, errors: report.errors }, null, 2));
  process.exit(report.ok ? 0 : 1);
}
