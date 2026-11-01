/**
 * Playwright Chromium e2e for voice-integration:
 * dictation insert, Direct overlay + Speaking + Interrupt, Orchestrator error, badge persistence.
 * Runs in two browser sessions to reduce peak memory on shared boxes.
 */
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const BASE = process.env.VOICE_BASE_URL || "http://127.0.0.1:8091";
const OUT = process.env.VOICE_E2E_OUT || "/workspace/voice-test/e2e-results.json";
const ROUNDTRIP_OUT = process.env.VOICE_ROUNDTRIP_OUT || "/workspace/voice-test/browser-roundtrip.json";
const CHROME =
  process.env.CHROME_PATH ||
  "/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const WAV =
  process.env.VOICE_FAKE_AUDIO ||
  resolve("public/voice-test/hello.wav");

const report = {
  at: new Date().toISOString(),
  base: BASE,
  ok: false,
  checks: {},
  errors: [],
  roundtrip: null,
};

function ok(name, pass, detail) {
  report.checks[name] = { pass: Boolean(pass), detail: detail ?? null };
}

async function launch() {
  return chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      ...(existsSync(WAV) ? [`--use-file-for-fake-audio-capture=${WAV}`] : []),
      "--autoplay-policy=no-user-gesture-required",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-sandbox",
    ],
  });
}

async function withPage(fn) {
  const browser = await launch();
  try {
    const context = await browser.newContext({ permissions: ["microphone"] });
    await context.grantPermissions(["microphone"], { origin: BASE });
    const page = await context.newPage();
    page.on("pageerror", (e) => report.errors.push(String(e)));
    await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

try {
  // Session A: dictation + orchestrator + badge persistence
  await withPage(async (page) => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60000 });
    await page.click('[data-testid="mic-button"]');
    await page.waitForSelector('[data-testid="dictation-pill"]', { timeout: 5000 });
    const stopVisible = await page.locator('[data-testid="dictation-stop"]').isVisible();
    const cancelVisible = await page.locator('[data-testid="dictation-cancel"]').isVisible();
    ok("dictation_pill_controls", stopVisible && cancelVisible, { stopVisible, cancelVisible });
    await page.click('[data-testid="dictation-stop"]');
    await page.waitForTimeout(800);
    const dictRoot = await page.locator("[data-dictation-root]").getAttribute("data-dictation-root");
    const dictStatus = await page.locator('[data-testid="dictation-status"]').innerText().catch(() => "");
    ok("dictation_finishes", dictRoot === "idle", { dictRoot, dictStatus });

    const toggle = page.locator('[data-testid="voice-mode-toggle-header"]');
    await toggle.click();
    await page.waitForTimeout(1500);
    const hint = await page.locator('[data-testid="voice-mode-hint-header"]').innerText().catch(() => "");
    const badgeText = await page.locator('[data-testid="voice-mode-badge-header"]').innerText();
    ok("orchestrator_hint", /Ollama not reachable/i.test(hint) && /Orchestrator/i.test(badgeText), { hint, badgeText });

    await page.waitForTimeout(400);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const afterReload = await page.locator('[data-testid="voice-mode-badge-header"]').innerText();
    ok("badge_persists_orchestrator", /Orchestrator/i.test(afterReload), { afterReload });
  });

  // Session B: Direct overlay round trip
  await withPage(async (page) => {
    await page.goto(`${BASE}/?voiceTestAudio=hello`, { waitUntil: "networkidle", timeout: 60000 });
    // Ensure Direct mode for realtime path
    const badge = page.locator('[data-testid="voice-mode-badge-header"]');
    const badgeText = await badge.innerText().catch(() => "");
    if (/Orchestrator/i.test(badgeText)) {
      await page.locator('[data-testid="voice-mode-toggle-header"]').click();
      await page.waitForTimeout(400);
    }
    await page.locator('[data-testid="voice-overlay-open"]').last().click();
    await page.waitForSelector('[data-testid="voice-overlay"]', { timeout: 15000 });
    const stages = [];
    let speaking = false;
    let transcript = null;
    const deadline = Date.now() + 75000;
    while (Date.now() < deadline) {
      const status = await page.locator('[data-testid="voice-overlay-status"]').innerText().catch(() => "");
      const phase = await page.locator('[data-testid="voice-overlay"]').getAttribute("data-voice-phase");
      const err = await page.locator('[data-testid="voice-overlay-error"]').innerText().catch(() => null);
      if (!stages.length || stages[stages.length - 1].status !== status || stages[stages.length - 1].phase !== phase) {
        stages.push({ status, phase, err });
      }
      if (phase === "error") break;
      const t = await page.locator('[data-testid="voice-overlay-transcript"]').innerText().catch(() => "");
      if (t.trim()) transcript = t.trim();
      if (/Speaking/i.test(status) || phase === "speaking") {
        speaking = true;
        break;
      }
      await page.waitForTimeout(300);
    }
    ok(
      "overlay_reaches_listening_or_speaking",
      stages.some((s) => /Listening|Speaking/i.test(s.status || "") || s.phase === "listening" || s.phase === "speaking"),
      { stages },
    );
    ok("overlay_transcript_or_speaking", Boolean(transcript || speaking), { transcript, speaking });

    let interruptOk = false;
    if (speaking) {
      const btn = page.locator('[data-testid="voice-interrupt"]');
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(600);
        const status = await page.locator('[data-testid="voice-overlay-status"]').innerText();
        interruptOk = /Interrupted/i.test(status);
      }
    } else if (stages.some((s) => s.phase === "listening")) {
      // Listening without Speaking still validates Direct connect; interrupt N/A
      interruptOk = false;
    }
    ok("interrupt", speaking ? interruptOk : false, { speaking, interruptOk, note: speaking ? null : "Speaking not reached; interrupt not exercised" });

    report.roundtrip = { stages, transcript, speaking, interruptOk };
    writeFileSync(
      ROUNDTRIP_OUT,
      JSON.stringify(
        {
          at: report.at,
          url: `${BASE}/?voiceTestAudio=hello`,
          ok: speaking || Boolean(transcript) || stages.some((s) => s.phase === "listening"),
          stages,
          transcript,
          speakingSeen: speaking,
          interruptResult: { ok: interruptOk },
          errors: report.errors,
        },
        null,
        2,
      ),
    );
  });

  report.ok = Object.values(report.checks).every((c) => c.pass);
} catch (e) {
  report.errors.push(String(e));
  report.ok = false;
} finally {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, errors: report.errors }, null, 2));
  process.exit(report.ok ? 0 : 1);
}
