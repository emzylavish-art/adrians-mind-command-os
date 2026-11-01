import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = "/workspace/voice-test";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL || "http://127.0.0.1:8095/";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.grantPermissions(["microphone", "camera"], { origin: new URL(BASE).origin });
const page = await context.newPage();

await page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForSelector('[data-testid="composer-bar"]', { timeout: 30_000 });

// Hang getUserMedia so Speak stays on connecting long enough for a real-app live shot
await page.evaluate(() => {
  const md = navigator.mediaDevices;
  md.getUserMedia = () => new Promise(() => {});
  if (md.getDisplayMedia) md.getDisplayMedia = () => new Promise(() => {});
});

const pick = async (id) =>
  page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      text: (el.innerText || "").replace(/\s+/g, " ").trim(),
      hasSvg: Boolean(el.querySelector("svg")),
      aria: el.getAttribute("aria-label"),
      w: r.width,
      h: r.height,
      x: r.x,
      y: r.y,
      inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth + 1,
    };
  }, id);

await page.screenshot({ path: `${OUT}/realapp-8095-idle.png`, fullPage: false });
const idle = {
  mic: await pick("composer-mic-dictate"),
  speak: await pick("composer-speak"),
  plus: await pick("composer-bar-plus"),
  composers: await page.locator('[data-testid="composer-bar"]').count(),
};

await page.click('[data-testid="composer-speak"]');
await page.waitForSelector('[data-testid="live-voice-bar"]', { timeout: 10_000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/realapp-8095-speak.png`, fullPage: false });

const live = {
  screen: await pick("live-voice-bar-screen"),
  speaker: await pick("live-voice-bar-speaker"),
  mute: await pick("live-voice-bar-mute"),
  settings: await pick("live-voice-bar-settings"),
  end: await pick("live-voice-bar-end"),
  plus: await pick("live-voice-bar-plus"),
  composers: await page
    .locator('[data-testid="composer-bar"], [data-testid="live-voice-bar"]')
    .count(),
  attr: await page.getAttribute('[data-testid="live-voice-bar"]', "data-live-voice"),
};

const report = {
  viewport: { w: 1280, h: 800 },
  idle: { ...idle, screenshot: `${OUT}/realapp-8095-idle.png` },
  live: { ...live, screenshot: `${OUT}/realapp-8095-speak.png` },
  ok:
    Boolean(idle.mic?.hasSvg && idle.speak?.hasSvg && idle.speak?.text === "Speak" && idle.plus?.hasSvg) &&
    idle.composers === 1 &&
    Boolean(idle.speak?.inView) &&
    Boolean(live.screen?.hasSvg && live.speaker?.hasSvg && live.mute?.hasSvg && live.settings?.hasSvg) &&
    Boolean(live.end?.hasSvg && live.plus?.hasSvg && live.end?.w >= 90) &&
    live.composers === 1 &&
    !live.screen?.text &&
    !live.speaker?.text &&
    !live.mute?.text &&
    !live.settings?.text &&
    !live.end?.text,
};
writeFileSync(`${OUT}/realapp-geometry.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!report.ok) process.exit(1);
