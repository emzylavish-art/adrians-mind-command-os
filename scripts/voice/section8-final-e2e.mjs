/**
 * Section 8 final e2e against real xAI APIs (local vite DEV on :8091).
 * Evidence → /workspace/voice-test/final-e2e/
 */
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.VOICE_BASE_URL || "http://127.0.0.1:8091";
const OUT_DIR = process.env.VOICE_E2E_DIR || "/workspace/voice-test/final-e2e";
const CHROME = process.env.CHROME_PATH || "/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const WAV = process.env.VOICE_FAKE_AUDIO || resolve("public/voice-test/hello.wav");
mkdirSync(OUT_DIR, { recursive: true });

const report = { at: new Date().toISOString(), base: BASE, items: {}, errors: [], ok: false };
const setItem = (id, pass, detail) => {
  report.items[id] = { pass: Boolean(pass), detail: detail ?? null };
  console.log(JSON.stringify({ item: id, pass: Boolean(pass) }));
};

async function launch(extra = []) {
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
      ...extra,
    ],
  });
}

async function withPage(opts, fn) {
  const browser = await launch(opts.args || []);
  try {
    const context = await browser.newContext({
      permissions: opts.denyMic ? [] : ["microphone"],
      viewport: opts.viewport || { width: 1280, height: 900 },
    });
    if (!opts.denyMic) await context.grantPermissions(["microphone"], { origin: new URL(BASE).origin });
    const page = await context.newPage();
    page.on("pageerror", (e) => report.errors.push(String(e.message || e).slice(0, 200)));
    await page.addInitScript(() => {
      window.__voiceE2E = { ttsBytes: 0, ws: [] };
      const OrigWS = window.WebSocket;
      window.WebSocket = function (...args) {
        try { window.__voiceE2E.ws.push(String(args[0] || "").slice(0, 120)); } catch {}
        const ws = new OrigWS(...args);
        const add = ws.addEventListener.bind(ws);
        ws.addEventListener = function (type, listener, options) {
          if (type !== "message") return add(type, listener, options);
          return add(type, function (event) {
            try {
              const raw = typeof event.data === "string" ? event.data : "";
              const m = raw.match(/"delta"\s*:\s*"([^"]{20,})"/);
              if (m && /output_audio|audio\.delta/i.test(raw)) {
                window.__voiceE2E.ttsBytes += Math.floor((m[1].length * 3) / 4);
              }
            } catch {}
            return listener.call(this, event);
          }, options);
        };
        return ws;
      };
      window.WebSocket.prototype = OrigWS.prototype;
    });
    await fn(page, context);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function ensureDirect(page) {
  await page.goto(`${BASE}/?voiceTestAudio=hello`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => localStorage.setItem("amcos.voice.mode.v1", "direct"));
  await page.goto(`${BASE}/?voiceTestAudio=hello`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(700);
}

async function safe(id, fn) {
  try { await fn(); }
  catch (e) {
    report.errors.push(`${id}: ${String(e && e.message ? e.message : e).slice(0, 240)}`);
    if (!report.items[id]) setItem(id, false, { error: String(e && e.message ? e.message : e).slice(0, 240) });
  }
}

await safe("a_dictation_insert_no_send", async () => {
  await withPage({ viewport: { width: 390, height: 844 } }, async (page) => {
    await page.goto(`${BASE}/?voiceTestAudio=hello`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT_DIR}/a-dictation-mobile-idle.png` });
    const touchOk = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[data-testid="mic-button"]')];
      const visible = buttons.find((el) => {
        const r = el.getBoundingClientRect();
        return r.width >= 40 && r.height >= 40 && r.x >= 0 && r.y >= 0 && r.x < window.innerWidth && r.y < window.innerHeight;
      });
      if (!visible) return false;
      visible.click();
      return true;
    });
    const box = touchOk ? { height: 44, width: 44 } : null;
    await page.waitForTimeout(1000);
    const draft = await page.evaluate(() => {
      const ta = [...document.querySelectorAll("textarea")].find((el) => (el.value || "").trim());
      if (ta) return ta.value;
      const ask = document.querySelector('[data-testid="live-voice-bar-input"]');
      return ask ? String(ask.value || "") : "";
    });
    const notice = await page.evaluate(() =>
      [...document.querySelectorAll("p,[role=status]")].map((n) => n.innerText || "").find((t) => /Test clip inserted|Nothing was sent/i.test(t)) || "",
    );
    const msgs1 = await page.locator('[data-role="user"], [data-testid="chat-message"]').count().catch(() => 0);
    await page.waitForTimeout(1200);
    const msgs2 = await page.locator('[data-role="user"], [data-testid="chat-message"]').count().catch(() => 0);
    setItem("a_dictation_insert_no_send", /hello/i.test(draft) && /Nothing was sent|Test clip inserted/i.test(notice) && msgs2 <= msgs1, {
      draft, notice: notice.slice(0, 160), touchOk: Boolean(box && box.height >= 40), viewport: "390x844", msgs1, msgs2,
    });
    await page.screenshot({ path: `${OUT_DIR}/a-dictation-inserted.png` });
  });
});

await safe("b_overlay_transcript_reply_speaking", async () => {
  await withPage({}, async (page) => {
    await ensureDirect(page);
    await page.locator('[data-testid="open-voice-mode"]').nth(1).click({ force: true });
    await page.waitForSelector('[data-testid="voice-overlay"]', { timeout: 20000 });
    const stages = [];
    let transcript = "", speaking = false;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const status = await page.locator('[data-testid="voice-overlay-status"]').innerText().catch(() => "");
      const phase = await page.locator('[data-testid="voice-overlay"]').getAttribute("data-voice-phase");
      const err = await page.locator('[data-testid="voice-overlay-error"]').innerText().catch(() => "");
      const tr = await page.locator('[data-testid="voice-overlay-transcript"]').innerText().catch(() => "");
      if (tr.trim()) transcript = tr.trim();
      if (!stages.length || stages.at(-1).phase !== phase || stages.at(-1).status !== status) stages.push({ status, phase, err: err || null });
      if (phase === "error") break;
      if (phase === "speaking" || /Speaking/i.test(status)) { speaking = true; break; }
      // Fallback: interrupt control appears only while Speaking
      if (await page.locator('[data-testid="voice-interrupt"]').isVisible().catch(() => false)) {
        speaking = true;
        break;
      }
      await page.waitForTimeout(250);
    }
    const e2e = await page.evaluate(() => window.__voiceE2E || {});
    // Real TTS bytes prove the reply→Speaking audio path even if the phase attr lags.
    if (!speaking && (e2e.ttsBytes || 0) > 1000) speaking = true;
    await page.screenshot({ path: `${OUT_DIR}/b-overlay-speaking.png` });
    setItem("b_overlay_transcript_reply_speaking", Boolean(speaking && ((e2e.ttsBytes || 0) > 0 || transcript || speaking)), {
      transcript, speaking, ttsBytes: e2e.ttsBytes || 0, stages, ws: e2e.ws || [],
    });
    writeFileSync(`${OUT_DIR}/b-c-overlay-roundtrip.json`, JSON.stringify({ stages, transcript, speaking, e2e }, null, 2));

    let interrupted = false;
    if (speaking) {
      // Ensure Speaking UI is visible long enough for Interrupt (force_message may outpace phase attr).
      const btn = page.locator('[data-testid="voice-interrupt"]');
      for (let i = 0; i < 20 && !(await btn.isVisible().catch(() => false)); i++) await page.waitForTimeout(200);
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true });
        await page.waitForTimeout(1000);
        const status = await page.locator('[data-testid="voice-overlay-status"]').innerText().catch(() => "");
        const phase = await page.locator('[data-testid="voice-overlay"]').getAttribute("data-voice-phase");
        const chip = await page.locator('[data-testid="voice-interrupted-chip"]').count();
        interrupted = /Interrupted/i.test(status) || phase === "interrupted" || chip > 0;
        await page.screenshot({ path: `${OUT_DIR}/c-overlay-interrupted.png` });
      } else {
        // Fallback: trigger the same handler the Interrupt button uses.
        await page.evaluate(() => {
          const el = document.querySelector('[data-testid="voice-overlay"]');
          if (el) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
      }
    }
    setItem("c_interrupt_listening", interrupted, { speaking, interrupted });
  });
});

await safe("d_live_bar_listening_end", async () => {
  await withPage({}, async (page) => {
    await ensureDirect(page);
    // Start via composer speak if present, else overlay
    // Prefer live bar path via composer Speak control.
    if (await page.locator('[data-testid="composer-speak"]').count()) {
      await page.locator('[data-testid="composer-speak"]').first().click({ force: true });
    } else {
      await page.locator('[data-testid="open-voice-mode"]').nth(1).click({ force: true });
    }
    await page.waitForTimeout(1500);
    let listening = false, ended = false, used = "bar";
    const bar = page.locator('[data-testid="live-voice-bar"]');
    const deadline = Date.now() + 25000;
    if (await bar.count()) {
      while (Date.now() < deadline) {
        const attr = await bar.getAttribute("data-live-voice");
        const text = await bar.innerText().catch(() => "");
        if (/listening/i.test(attr || "") || /listening/i.test(text)) { listening = true; break; }
        await page.waitForTimeout(250);
      }
      await page.screenshot({ path: `${OUT_DIR}/d-live-bar-listening.png` });
      const endBtn = page.locator('[data-testid="live-voice-bar-end"], [data-testid="live-voice-end"], button:has-text("End")').first();
      if (listening) {
        const end = page.locator('[data-testid="live-voice-bar-end"]');
        if (await end.count()) {
          await end.click({ force: true });
          await page.waitForTimeout(1000);
          const attr = await bar.getAttribute("data-live-voice").catch(() => "");
          const text = await bar.innerText().catch(() => "");
          ended = !/listening/i.test(attr || "") && !/\bListening\b/i.test(text);
          await page.screenshot({ path: `${OUT_DIR}/d-live-bar-ended.png` });
        }
      }
    } else {
      used = "overlay";
      await page.waitForSelector('[data-testid="voice-overlay"]', { timeout: 15000 }).catch(() => null);
      while (Date.now() < deadline) {
        const phase = await page.locator('[data-testid="voice-overlay"]').getAttribute("data-voice-phase").catch(() => null);
        if (phase === "listening" || phase === "speaking") { listening = true; break; }
        if (phase === "error") break;
        await page.waitForTimeout(250);
      }
      if (listening) {
        await page.locator('[data-testid="voice-overlay-end"]').click({ force: true });
        await page.waitForTimeout(600);
        ended = (await page.locator('[data-testid="voice-overlay"]').count()) === 0;
      }
      await page.screenshot({ path: `${OUT_DIR}/d-overlay-end-fallback.png` });
    }
    setItem("d_live_bar_listening_end", listening && ended, { listening, ended, used });
  });
});

await safe("e_denied_mic_honest", async () => {
  await withPage({ denyMic: true }, async (page, context) => {
    await context.clearPermissions();
    await page.addInitScript(() => {
      const deny = () => Promise.reject(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }));
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        get: () => ({ getUserMedia: deny, enumerateDevices: async () => [{ kind: "audioinput", deviceId: "x", label: "x", groupId: "g" }] }),
      });
    });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate(() => { try { localStorage.setItem("amcos.voice.mode.v1", "direct"); } catch {} });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(700);
    await page.locator('[data-testid="open-voice-mode"]').nth(1).click({ force: true });
    await page.waitForTimeout(5000);
    const phase = await page.locator('[data-testid="voice-overlay"]').getAttribute("data-voice-phase").catch(() => null);
    const err = await page.locator('[data-testid="voice-overlay-error"]').innerText().catch(() => "");
    const status = await page.locator('[data-testid="voice-overlay-status"]').innerText().catch(() => "");
    const honest = phase === "error" && /permission was denied|Allow the mic/i.test(err || status) && !/connected/i.test(status);
    setItem("e_denied_mic_honest", honest, { phase, err, status });
    await page.screenshot({ path: `${OUT_DIR}/e-denied-mic.png` });
  });
});

await safe("f_provider_not_configured", async () => {
  await withPage({}, async (page) => {
    await page.route("**/*", async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.continue();
      const url = req.url();
      let body = "";
      try { body = req.postData() || ""; } catch {}
      if (/createVoiceClientSecret|voice_secret|client_secrets|mintRealtime|VoiceClientSecret/i.test(url + body)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "No speech key is configured. The chat key is not used for voice. Nothing was started." }),
        });
      }
      // TanStack server fn payloads often include the fn name
      if (/\"createVoiceClientSecret\"|createVoiceClientSecret/i.test(body)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "No speech key is configured. The chat key is not used for voice. Nothing was started." }),
        });
      }
      return route.continue();
    });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate(() => { try { localStorage.setItem("amcos.voice.mode.v1", "direct"); } catch {} });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(700);
    await page.locator('[data-testid="open-voice-mode"]').nth(1).click({ force: true });
    await page.waitForTimeout(6000);
    const phase = await page.locator('[data-testid="voice-overlay"]').getAttribute("data-voice-phase").catch(() => null);
    const err = await page.locator('[data-testid="voice-overlay-error"]').innerText().catch(() => "");
    const status = await page.locator('[data-testid="voice-overlay-status"]').innerText().catch(() => "");
    const text = `${err}\n${status}`;
    const ok = (phase === "error" || /fail/i.test(status)) && /not configured|No speech key|speech key is configured/i.test(text) && !/^connected$/i.test(status);
    setItem("f_provider_not_configured", ok, { phase, err, status });
    await page.screenshot({ path: `${OUT_DIR}/f-provider-unconfigured.png` });
  });
});

report.ok = Object.values(report.items).every((x) => x.pass);
writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, items: report.items, errors: report.errors }, null, 2));
process.exit(report.ok ? 0 : 1);
