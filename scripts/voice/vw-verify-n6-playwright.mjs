/**
 * N6 verify pass: live bar controls, Speak, Esc cancel at 390px and 1024px.
 * Screenshots → /workspace/voice-test/vw-verify-n6-*.png
 * Never prints secrets.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/workspace/voice-test";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL || "http://127.0.0.1:8095/";
const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1024", width: 1024, height: 768 },
];

const args = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
];

const report = {
  started_at: new Date().toISOString(),
  base: BASE,
  viewports: {},
  ok: false,
};

function shot(name) {
  return `${OUT}/vw-verify-n6-${name}.png`;
}

async function pick(page, id) {
  return page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      text: (el.innerText || "").replace(/\s+/g, " ").trim(),
      hasSvg: Boolean(el.querySelector("svg")),
      aria: el.getAttribute("aria-label"),
      pressed: el.getAttribute("aria-pressed"),
      w: Math.round(r.width),
      h: Math.round(r.height),
      inView: r.top >= -2 && r.bottom <= innerHeight + 2 && r.left >= -2 && r.right <= innerWidth + 2,
    };
  }, id);
}

const browser = await chromium.launch({ headless: true, args });

for (const vp of VIEWPORTS) {
  const v = { checks: {}, errors: [], screenshots: [] };
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    permissions: ["microphone", "camera"],
  });
  await context.grantPermissions(["microphone", "camera"], { origin: new URL(BASE).origin });
  const page = await context.newPage();
  page.on("pageerror", (e) => v.errors.push(`pageerror:${e.message.slice(0, 120)}`));

  try {
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForSelector('[data-testid="composer-bar"]', { timeout: 30_000 });

    // Hang getUserMedia so Speak lands on connecting/live without needing a real mint race
    await page.evaluate(() => {
      const md = navigator.mediaDevices;
      const orig = md.getUserMedia?.bind(md);
      md.getUserMedia = (constraints) => {
        // Resolve quickly with a silent fake so we can reach live bar; Esc still cancels.
        if (!orig) {
          return Promise.reject(Object.assign(new Error("no gum"), { name: "NotFoundError" }));
        }
        return orig(constraints).catch(() => {
          // Chromium fake device should succeed; if not, leave connecting via pending promise briefly
          return new Promise((resolve, reject) => {
            setTimeout(() => reject(Object.assign(new Error("fake-mic-timeout"), { name: "NotAllowedError" })), 8_000);
          });
        });
      };
    });

    const idlePath = shot(`${vp.name}-idle`);
    await page.screenshot({ path: idlePath, fullPage: false });
    v.screenshots.push(idlePath);

    const speakBtn = await pick(page, "composer-speak");
    v.checks.speak_visible = Boolean(speakBtn?.inView && (speakBtn.hasSvg || /speak/i.test(speakBtn.text || speakBtn.aria || "")));
    if (!speakBtn) v.errors.push("composer-speak missing");

    // Speak → live bar
    await page.click('[data-testid="composer-speak"]');
    let liveAppeared = false;
    try {
      await page.waitForSelector('[data-testid="live-voice-bar"]', { timeout: 25_000 });
      liveAppeared = true;
    } catch (e) {
      v.errors.push(`live-bar-timeout:${String(e).slice(0, 100)}`);
      // Still shot for diagnosis
    }
    await page.waitForTimeout(500);
    const speakPath = shot(`${vp.name}-speak`);
    await page.screenshot({ path: speakPath, fullPage: false });
    v.screenshots.push(speakPath);

    v.checks.speak_opens_live_bar = liveAppeared;
    if (liveAppeared) {
      const controls = {
        screen: await pick(page, "live-voice-bar-screen"),
        speaker: await pick(page, "live-voice-bar-speaker"),
        mute: await pick(page, "live-voice-bar-mute"),
        settings: await pick(page, "live-voice-bar-settings"),
        end: await pick(page, "live-voice-bar-end"),
      };
      v.controls = controls;
      v.checks.live_controls_present = Boolean(
        controls.screen && controls.speaker && controls.mute && controls.settings && controls.end,
      );
      v.checks.live_controls_in_view = Boolean(
        controls.screen?.inView &&
          controls.speaker?.inView &&
          controls.mute?.inView &&
          controls.settings?.inView &&
          controls.end?.inView,
      );
      v.liveAttr = await page.getAttribute('[data-testid="live-voice-bar"]', "data-live-voice");

      // Esc cancel → bar should leave / end call
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
      const afterEscPath = shot(`${vp.name}-esc`);
      await page.screenshot({ path: afterEscPath, fullPage: false });
      v.screenshots.push(afterEscPath);

      const stillLive = await page.locator('[data-testid="live-voice-bar"]').count();
      const liveAttrAfter = stillLive
        ? await page.getAttribute('[data-testid="live-voice-bar"]', "data-live-voice")
        : "gone";
      // Esc ends call: either bar gone or data-live-voice off, and Speak visible again
      const speakBack = await pick(page, "composer-speak");
      v.checks.esc_cancels =
        stillLive === 0 ||
        liveAttrAfter === "off" ||
        liveAttrAfter === null ||
        Boolean(speakBack?.inView && (stillLive === 0 || liveAttrAfter === "off"));
      v.afterEsc = { stillLive, liveAttrAfter, speakVisible: Boolean(speakBack?.inView) };
    } else {
      v.checks.live_controls_present = false;
      v.checks.live_controls_in_view = false;
      v.checks.esc_cancels = false;
    }
  } catch (e) {
    v.errors.push(String(e).slice(0, 200));
  }

  v.ok =
    v.checks.speak_visible &&
    v.checks.speak_opens_live_bar &&
    v.checks.live_controls_present &&
    v.checks.live_controls_in_view &&
    v.checks.esc_cancels &&
    v.errors.length === 0;

  report.viewports[vp.name] = v;
  await context.close();
}

await browser.close();
report.ok = Object.values(report.viewports).every((v) => v.ok);
report.finished_at = new Date().toISOString();
writeFileSync(`${OUT}/vw-verify-n6-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
