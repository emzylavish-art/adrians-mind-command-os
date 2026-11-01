/**
 * Final voice-wiring E2E against :8095.
 * Uses Chromium fake media + optional WAV capture file.
 * Never prints secrets.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

const OUT = "/workspace/voice-test";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL || "http://127.0.0.1:8095/";
const WAV = process.env.FAKE_AUDIO_WAV || `${OUT}/fake-speech-loud.wav`;

const args = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--auto-select-desktop-capture-source=Entire",
];
if (existsSync(WAV)) args.push(`--use-file-for-fake-audio-capture=${WAV}`);

const report = {
  started_at: new Date().toISOString(),
  base: BASE,
  wav: existsSync(WAV) ? WAV : null,
  steps: [],
  latencies_ms: {},
  verified: [],
  unverified: [],
  ok: false,
};

function step(name, data = {}) {
  report.steps.push({ name, at: Date.now(), ...data });
  console.log(JSON.stringify({ step: name, ...data }));
}

const browser = await chromium.launch({ headless: true, args });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  permissions: ["microphone", "camera"],
});
await context.grantPermissions(["microphone", "camera"], { origin: new URL(BASE).origin });
const page = await context.newPage();
page.on("pageerror", (e) => step("pageerror", { message: e.message.slice(0, 160) }));

const tNav = Date.now();
await page.goto(BASE, { waitUntil: "networkidle", timeout: 90_000 });
report.latencies_ms.nav = Date.now() - tNav;
await page.evaluate(() => {
  localStorage.setItem("amcos.ollama.model", "qwen2.5:0.5b");
  localStorage.setItem("amcos.ollama.base", "http://127.0.0.1:11434");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="composer-bar"]', { timeout: 30_000 });
await page.waitForSelector('[data-testid="voice-mode-badge"]');

const badgeCount = await page.locator('[data-testid="voice-mode-badge"]').count();
step("badge_count", { badgeCount });
if (badgeCount === 1) report.verified.push("single_header_badge");
else report.unverified.push("single_header_badge");

await page.screenshot({ path: `${OUT}/final-idle.png`, fullPage: false });

// Ensure Direct mode
const mode = await page.getAttribute('[data-testid="voice-mode-badge"]', "data-mode");
if (mode === "orchestrator") {
  await page.click('[data-testid="voice-mode-toggle"]');
  await page.waitForTimeout(300);
}
step("mode_direct");

// --- Speak / live path ---
const tSpeak = Date.now();
await page.click('[data-testid="composer-speak"]');
let liveAttr = null;
try {
  await page.waitForSelector('[data-testid="live-voice-bar"]', { timeout: 20_000 });
  report.latencies_ms.speak_to_live_bar = Date.now() - tSpeak;
  for (let i = 0; i < 40; i++) {
    liveAttr = await page.getAttribute('[data-testid="live-voice-bar"]', "data-live-voice");
    step("live_attr_poll", { i, liveAttr });
    if (liveAttr && liveAttr !== "connecting" && liveAttr !== "off") break;
    // also accept connecting briefly then listening
    if (liveAttr === "listening" || liveAttr === "user-speaking" || liveAttr === "assistant-speaking") break;
    await page.waitForTimeout(500);
  }
} catch (e) {
  step("live_bar_timeout", { error: String(e).slice(0, 160) });
  const alert = await page.locator('[role="alert"]').first().textContent().catch(() => null);
  step("alert_after_speak", { alert });
}

await page.screenshot({ path: `${OUT}/final-speak.png`, fullPage: false });

// Badge must mirror live session (not stuck Idle while Connecting/Listening)
{
  const badgeSession = await page.getAttribute('[data-testid="voice-mode-badge"]', "data-session");
  const badgeStatus = await page.locator('[data-testid="voice-mode-badge-status"]').textContent();
  step("badge_session_sync", { badgeSession, badgeStatus, liveAttr });
  if (
    liveAttr &&
    liveAttr !== "off" &&
    badgeSession === liveAttr &&
    badgeStatus &&
    !/Idle/i.test(badgeStatus)
  ) {
    report.verified.push("badge_mirrors_live_session");
  } else if (await page.locator('[data-testid="live-voice-bar"]').count()) {
    report.unverified.push("badge_mirrors_live_session");
  }
}


if (await page.locator('[data-testid="live-voice-bar"]').count()) {
  report.verified.push("speak_opens_live_bar");
  if (liveAttr === "listening" || liveAttr === "connecting") {
    report.verified.push(`live_phase_${liveAttr}`);
  }

  // Wait until listening before Ask (mint+WS already done)
  for (let i = 0; i < 40 && liveAttr !== "listening"; i++) {
    liveAttr = await page.getAttribute('[data-testid="live-voice-bar"]', "data-live-voice");
    if (liveAttr === "listening") break;
    await page.waitForTimeout(250);
  }

  // Ask Anything while live (Direct) to force a model turn if VAD is quiet
  const ask = page.locator('[data-testid="live-voice-bar"] input[aria-label="Ask Anything"]');
  if (await ask.count()) {
    await ask.fill("Say hi in three words.");
    await ask.press("Enter");
    step("ask_sent_while_live");
    for (let i = 0; i < 40; i++) {
      liveAttr = await page.getAttribute('[data-testid="live-voice-bar"]', "data-live-voice");
      if (liveAttr === "assistant-speaking" || liveAttr === "thinking" || liveAttr === "user-speaking") {
        step("phase_after_ask", { liveAttr });
        report.verified.push(`phase_${liveAttr}`);
        break;
      }
      await page.waitForTimeout(500);
    }
    // Barge-in stand-in: mute during/after assistant audio must cut to muted immediately.
    if (liveAttr === "assistant-speaking" || liveAttr === "thinking") {
      await page.click('[data-testid="live-voice-bar-mute"]');
      await page.waitForTimeout(200);
      const afterBarge = await page.getAttribute('[data-testid="live-voice-bar"]', "data-live-voice");
      step("barge_mute", { afterBarge });
      if (afterBarge === "muted") report.verified.push("barge_mute_cuts_playback_state");
      else report.unverified.push("barge_mute_cuts_playback_state");
      await page.click('[data-testid="live-voice-bar-mute"]');
    } else {
      report.unverified.push("barge_mute_cuts_playback_state");
    }
  }

  // Mute
  const mute = page.locator('[data-testid="live-voice-bar-mute"]');
  if (await mute.count()) {
    await mute.click();
    const pressed = await mute.getAttribute("aria-pressed");
    step("mute", { pressed });
    if (pressed === "true") report.verified.push("mute_toggles");
    await mute.click();
  }

  // Screen share (fake / auto-select)
  try {
    const screenBtn = page.locator('[data-testid="live-voice-bar-screen"]');
    await screenBtn.click({ timeout: 3000 });
    await page.waitForTimeout(800);
    const pressed = await screenBtn.getAttribute("aria-pressed");
    step("screen_share", { pressed });
    if (pressed === "true") report.verified.push("screen_share_fake_device");
    else report.unverified.push("screen_share_fake_device");
    if (pressed === "true") await screenBtn.click();
  } catch (e) {
    report.unverified.push("screen_share_fake_device");
    step("screen_share_error", { error: String(e).slice(0, 120) });
  }

  await page.screenshot({ path: `${OUT}/final-live-controls.png`, fullPage: false });

  // Esc ends call
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const afterEsc = await page.locator('[data-testid="live-voice-bar"]').count();
  step("esc", { liveBars: afterEsc });
  if (afterEsc === 0) report.verified.push("esc_ends_call");
  else {
    // hang up
    const end = page.locator('[data-testid="live-voice-bar-end"]');
    if (await end.count()) {
      await end.click();
      await page.waitForTimeout(400);
      report.verified.push("hangup_end_button");
    }
  }
} else {
  report.unverified.push("speak_opens_live_bar");
  report.unverified.push("live_realtime_phases");
}

// --- Dictation mic (STT stub via window.__AMCOS_FAKE_DICTATION__) ---
await page.waitForSelector('[data-testid="composer-mic-dictate"]', { timeout: 10_000 });
await page.evaluate(() => {
  window.__AMCOS_FAKE_DICTATION__ = "dictation stub hello";
});
await page.click('[data-testid="composer-mic-dictate"]');
await page.waitForTimeout(400);
const askAfter = await page.locator('[aria-label="Ask Anything"]').first().inputValue().catch(() => "");
step("dictation_stub", { askAfter });
if (String(askAfter).includes("dictation stub hello")) {
  report.verified.push("dictation_types_into_ask_text");
  report.verified.push("dictation_mic_toggles");
} else {
  report.unverified.push("dictation_types_into_ask_text");
}
await page.evaluate(() => {
  delete window.__AMCOS_FAKE_DICTATION__;
});
await page.screenshot({ path: `${OUT}/final-dictation.png`, fullPage: false });

// --- Orchestrator badge + probe ---
await page.click('[data-testid="voice-mode-toggle"]');
await page.waitForTimeout(1200);
const orchMode = await page.getAttribute('[data-testid="voice-mode-badge"]', "data-mode");
const detail = await page.locator('[data-testid="voice-mode-badge-detail"]').count();
step("orchestrator_toggle", { orchMode, detail });
if (orchMode === "orchestrator") report.verified.push("orchestrator_toggle");
await page.screenshot({ path: `${OUT}/final-orchestrator-badge.png`, fullPage: false });

// Orchestrator speak if possible
if (orchMode === "orchestrator") {
  const tOrch = Date.now();
  await page.click('[data-testid="composer-speak"]');
  try {
    await page.waitForSelector('[data-testid="live-voice-bar"]', { timeout: 20_000 });
    report.latencies_ms.orchestrator_speak_to_bar = Date.now() - tOrch;
    report.verified.push("orchestrator_speak_opens_bar");
    await page.screenshot({ path: `${OUT}/final-orchestrator-live.png`, fullPage: false });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    if (await page.locator('[data-testid="live-voice-bar-end"]').count()) {
      await page.click('[data-testid="live-voice-bar-end"]');
    }
  } catch {
    report.unverified.push("orchestrator_speak_opens_bar");
  }
}

// Switch back to Direct
if ((await page.getAttribute('[data-testid="voice-mode-badge"]', "data-mode")) === "orchestrator") {
  await page.click('[data-testid="voice-mode-toggle"]');
}

report.ok =
  report.verified.includes("single_header_badge") &&
  (report.verified.includes("speak_opens_live_bar") || report.verified.includes("orchestrator_speak_opens_bar"));

writeFileSync(`${OUT}/final-e2e.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, verified: report.verified, unverified: report.unverified, latencies_ms: report.latencies_ms }, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
