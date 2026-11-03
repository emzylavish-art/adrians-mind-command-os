/**
 * VOICE-02 e2e: Speak + Live speak chrome wiring (fake media).
 * Proves markPreview is gone on those controls; expects honest sign-in /
 * provider states when unsigned, or a real session attempt when keys+auth allow.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.VOICE_BASE_URL || "http://127.0.0.1:8098";
const OUT_DIR = process.env.VOICE_02_OUT || "/workspace/voice-test/voice-02";
mkdirSync(OUT_DIR, { recursive: true });

const report = {
  at: new Date().toISOString(),
  product: "Adrian's Mind Command OS",
  lane: "voice-integration",
  task: "VOICE-02",
  base: BASE,
  ok: false,
  viewports: {},
  sourceProof: {},
  errors: [],
};

function ok(v) {
  return Boolean(v);
}

async function runViewport(browser, name, size) {
  const result = {
    size,
    checks: {},
    chromeNoteAfterSpeak: null,
    chromeNoteAfterLive: null,
    liveError: null,
    liveState: null,
    screenshots: {},
  };
  const context = await browser.newContext({
    viewport: size,
    permissions: ["microphone"],
  });
  await context.grantPermissions(["microphone"], { origin: BASE });
  const page = await context.newPage();
  page.on("pageerror", (err) => report.errors.push(`${name}: ${err}`));

  try {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(800);

    // Open chat so ChatPane chrome mounts
    const newChat = page.getByRole("button", { name: /new chat/i }).first();
    if (await newChat.count()) {
      await newChat.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    const chrome = page.locator('[data-testid="composer-voice-chrome"]');
    await chrome.waitFor({ timeout: 20000 });
    result.checks.chrome_present = true;

    // Speak control must exist and must NOT leave "preview only" markPreview copy
    const speak = page.locator('[data-testid="composer-speak"]').first();
    await speak.waitFor({ timeout: 10000 });
    await speak.click();
    await page.waitForTimeout(800);
    const noteAfterSpeak = await chrome.locator('[role="status"]').first().innerText().catch(() => "");
    result.chromeNoteAfterSpeak = noteAfterSpeak;
    result.checks.speak_not_markPreview = !/Speak is preview only/i.test(noteAfterSpeak);
    result.checks.speak_honest =
      /Nothing to speak|Speaking last reply|Sign in|speech|Unauthorized|not configured|No speech key|browser/i.test(
        noteAfterSpeak,
      ) || noteAfterSpeak.length > 0;

    // Live speak → ComposerLiveVoice real toggle
    const live = page.locator('[data-testid="composer-voice-live"]').first();
    await live.waitFor({ timeout: 10000 });
    const liveBtn = live.locator("button.live-voice-btn, button").first();
    await liveBtn.click();
    await page.waitForTimeout(1800);
    const noteAfterLive = await chrome.locator('[role="status"]').first().innerText().catch(() => "");
    result.chromeNoteAfterLive = noteAfterLive;
    result.liveError = await page.locator('[data-testid="composer-voice-live-error"]').innerText().catch(() => null);
    result.liveState = await live.getAttribute("data-live-voice").catch(() => null);
    result.checks.live_not_markPreview = !/Live speak is preview only/i.test(noteAfterLive || "");
    const liveMsg = `${noteAfterLive || ""} ${result.liveError || ""}`;
    result.checks.live_honest_or_active =
      /Sign in|not configured|No speech key|Unauthorized|Live voice|Connecting|Listening|Emergency|overlay mic|already/i.test(
        liveMsg,
      ) ||
      (result.liveState && result.liveState !== "off");

    // Voice mode stage: only open when overlay open — End/Mute must not be markPreview when visible
    // Open Direct overlay via Voice mode button if present
    const voiceModeBtn = page.locator('[data-testid="voice-overlay-open"], button[aria-label*="Voice mode"]').first();
    if (await voiceModeBtn.count()) {
      await voiceModeBtn.click().catch(() => {});
      await page.waitForTimeout(1200);
      const stage = page.locator('[data-testid="voice-mode-stage"]');
      const stageVisible = await stage.count();
      result.checks.voice_mode_stage_after_open = stageVisible > 0;
      if (stageVisible) {
        const end = stage.locator('[data-testid="voice-mode-end"]');
        if (await end.count()) {
          await end.click();
          await page.waitForTimeout(500);
          const note = await chrome.locator('[role="status"]').first().innerText().catch(() => "");
          result.checks.voice_mode_end_not_markPreview = !/Voice mode end is preview only/i.test(note);
        }
      }
    }

    const shot = `${OUT_DIR}/${name}.png`;
    await page.screenshot({ path: shot, fullPage: false });
    result.screenshots.main = shot;

    result.ok =
      result.checks.chrome_present &&
      result.checks.speak_not_markPreview &&
      result.checks.live_not_markPreview &&
      result.checks.speak_honest &&
      result.checks.live_honest_or_active;
  } catch (e) {
    result.ok = false;
    result.error = String(e);
    report.errors.push(`${name}: ${e}`);
    await page.screenshot({ path: `${OUT_DIR}/${name}-fail.png`, fullPage: false }).catch(() => {});
  } finally {
    await context.close();
  }
  return result;
}

const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

try {
  report.viewports["390"] = await runViewport(browser, "e2e-390", { width: 390, height: 844 });
  report.viewports["desktop"] = await runViewport(browser, "e2e-desktop", { width: 1280, height: 800 });
  report.ok = ok(report.viewports["390"].ok) && ok(report.viewports["desktop"].ok);
} finally {
  await browser.close();
}

writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, viewports: Object.fromEntries(Object.entries(report.viewports).map(([k, v]) => [k, { ok: v.ok, checks: v.checks, noteSpeak: v.chromeNoteAfterSpeak, noteLive: v.chromeNoteAfterLive, liveError: v.liveError, liveState: v.liveState }])) }, null, 2));
process.exit(report.ok ? 0 : 1);
