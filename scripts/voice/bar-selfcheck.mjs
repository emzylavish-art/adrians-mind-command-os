/**
 * Headless self-check: idle composer + forced live-call chrome sizes at 1280x800.
 * Uses a static Tailwind CDN fixture mirroring Voice Wiring DOM (no secrets).
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.VOICE_TEST_DIR || "/workspace/voice-test";
mkdirSync(OUT, { recursive: true });

const html = `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<script src="https://cdn.tailwindcss.com"></script>
<style>body{background:#000;margin:0;min-height:100vh}</style>
</head><body>
<!-- IDLE -->
<div id="idle" class="composer-bar is-fixed fixed inset-x-0 bottom-0 z-40 px-3 pb-3 pt-2 md:px-5" data-testid="composer-bar">
  <div class="composer-bar__safe mx-auto w-full max-w-3xl">
    <div class="composer-bar__card rounded-[1.75rem] border border-white/10 bg-[#111111] p-3 text-zinc-100 shadow-2xl">
      <div class="composer-bar__ask mb-3" data-testid="composer-bar-ask">
        <input placeholder="Ask Anything" class="h-10 w-full bg-transparent px-2 text-base text-zinc-100 outline-none" data-testid="live-voice-bar-input"/>
      </div>
      <div class="composer-bar__row flex items-center gap-2">
        <div class="composer-bar__left flex items-center gap-2">
          <button class="composer-bar__plus grid size-10 place-items-center rounded-full border border-white/10 bg-[#1c1c1e]" data-testid="composer-bar-plus">+</button>
          <div class="composer-bar__model rounded-full border border-white/10 bg-[#1c1c1e] px-3 py-2 text-xs" data-testid="composer-bar-model">Grok 4.5</div>
        </div>
        <div class="flex-1"></div>
        <div class="composer-voice-btns flex items-center gap-2">
          <button class="composer-mic-dictate grid size-10 place-items-center rounded-full border border-white/10 bg-[#1c1c1e]" data-testid="composer-mic-dictate" data-state="idle" aria-label="Dictate">mic</button>
          <button class="composer-speak-pill inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black" data-testid="composer-speak" aria-label="Start voice conversation">Speak</button>
        </div>
      </div>
    </div>
  </div>
</div>
<!-- LIVE (hidden until toggled) -->
<div id="live" class="live-voice-bar live-voice-control fixed inset-x-0 bottom-0 z-40 hidden px-3 pb-3 pt-2 md:px-5" data-testid="live-voice-bar" data-live-voice="listening" style="--live-level:0.4">
  <div class="relative mx-auto w-full max-w-3xl rounded-[1.75rem] border border-white/10 bg-[#0a0a0a] p-3 text-zinc-100 shadow-2xl">
    <div class="live-call-grid mb-3 grid grid-cols-4 gap-2">
      <button class="live-call-pill flex h-14 items-center justify-center rounded-2xl border border-white/10 bg-[#1c1c1e]" data-testid="live-voice-bar-screen">share</button>
      <button class="live-call-pill flex h-14 items-center justify-center rounded-2xl border border-white/10 bg-[#1c1c1e]" data-testid="live-voice-bar-speaker">spk</button>
      <button class="live-call-pill flex h-14 items-center justify-center rounded-2xl border border-white/10 bg-[#1c1c1e]" data-testid="live-voice-bar-mute">mic</button>
      <button class="live-call-pill flex h-14 items-center justify-center rounded-2xl border border-white/10 bg-[#1c1c1e]" data-testid="live-voice-bar-settings">gear</button>
    </div>
    <div class="live-voice-bar__composer flex items-center gap-2">
      <button class="live-voice-bar__plus grid size-10 place-items-center rounded-full bg-[#1c1c1e]" data-testid="live-voice-bar-plus">+</button>
      <div class="live-voice-bar__ask min-w-0 flex-1" data-testid="live-voice-bar-input"><input class="h-11 w-full rounded-full border border-white/10 bg-[#1c1c1e] px-4 text-sm" placeholder="Ask Anything"/></div>
      <button class="live-call-end grid h-12 w-14 place-items-center rounded-full bg-[#f26b6b] text-white" data-testid="live-voice-bar-end">☎</button>
    </div>
  </div>
</div>
</body></html>`;

const fixture = join(OUT, "bar-selfcheck.html");
writeFileSync(fixture, html);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("file://" + fixture, { waitUntil: "networkidle" });

async function measure(sel) {
  return page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, x: r.x, y: r.y, vw: window.innerWidth, vh: window.innerHeight };
  });
}

const idlePath = join(OUT, "selfcheck-idle-composer.png");
await page.screenshot({ path: idlePath, fullPage: false });
const speak = await measure('[data-testid="composer-speak"]');
const mic = await measure('[data-testid="composer-mic-dictate"]');
const bar = await measure('[data-testid="composer-bar"]');

await page.evaluate(() => {
  document.getElementById("idle").classList.add("hidden");
  document.getElementById("live").classList.remove("hidden");
});
const livePath = join(OUT, "selfcheck-live-call.png");
await page.screenshot({ path: livePath, fullPage: false });
const end = await measure('[data-testid="live-voice-bar-end"]');
const mute = await measure('[data-testid="live-voice-bar-mute"]');
const liveRoot = await measure('[data-testid="live-voice-bar"]');

const report = {
  viewport: { w: 1280, h: 800 },
  idle: { speak, mic, bar, screenshot: idlePath },
  live: { end, mute, liveRoot, screenshot: livePath },
  ok:
    speak.w > 40 &&
    speak.h > 24 &&
    speak.x >= 0 &&
    speak.x + speak.w <= 1280 &&
    end.w > 40 &&
    end.h > 40 &&
    liveRoot.x < 200, // not shoved to the right edge
};
writeFileSync(join(OUT, "selfcheck-geometry.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!report.ok) process.exitCode = 2;
