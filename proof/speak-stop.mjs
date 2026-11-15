import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof/phone";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const report = {};

async function openSpeak() {
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Build", exact: true }).first().click();
  await page.getByRole("navigation", { name: "Build sections" }).getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByTestId("owner-flow-speak").click();
  await page.getByTestId("speak-emergency-stop").waitFor();
}

async function playSpeech() {
  return page.evaluate(async () => {
    const sampleRate = 8000;
    const samples = sampleRate * 8;
    const pcm = new Int16Array(samples);
    for (let i = 0; i < samples; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 6000);
    const buffer = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(buffer);
    const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    write(0, "RIFF");
    view.setUint32(4, 36 + pcm.length * 2, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, pcm.length * 2, true);
    new Int16Array(buffer, 44).set(pcm);
    const audio = new Audio(URL.createObjectURL(new Blob([buffer], { type: "audio/wav" })));
    audio.setAttribute("data-testid", "proof-speech");
    audio.loop = true;
    document.body.appendChild(audio);
    await audio.play();
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { paused: audio.paused, time: audio.currentTime };
  });
}

async function speechState() {
  return page.evaluate(() => {
    const audio = document.querySelector("[data-testid='proof-speech']");
    return {
      paused: audio instanceof HTMLAudioElement ? audio.paused : null,
      time: audio instanceof HTMLAudioElement ? audio.currentTime : null,
      text: document.querySelector("[data-testid='speak-speech-cut']")?.textContent || "",
      clearOnSpeak: [...document.querySelectorAll("[data-testid='speak-stage'] button")].some((button) => button.textContent === "Clear stop"),
    };
  });
}

await openSpeak();
const started = await playSpeech();
if (started.paused || started.time <= 0) throw new Error(`Speech was not playing before the tab-close cut: ${JSON.stringify(started)}`);
await page.evaluate(() => {
  window.dispatchEvent(new Event("beforeunload"));
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
});
const closed = await speechState();
await page.waitForTimeout(500);
const closedLater = await speechState();
report.tabClose = { started, closed, closedLater, frozen: closed.paused && closedLater.time === closed.time };
await page.screenshot({ path: `${root}/speak-tab-close-cut.png` });

await openSpeak();
const playing = await playSpeech();
if (playing.paused || playing.time <= 0) throw new Error(`Speech was not playing before the button cut: ${JSON.stringify(playing)}`);
const cut = await page.evaluate(() => {
  const audio = document.querySelector("[data-testid='proof-speech']");
  const startedAt = performance.now();
  document.querySelector("[data-testid='speak-emergency-stop']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return {
    elapsedMs: performance.now() - startedAt,
    paused: audio instanceof HTMLAudioElement ? audio.paused : null,
    time: audio instanceof HTMLAudioElement ? audio.currentTime : null,
  };
});
await page.waitForTimeout(500);
const stopped = await speechState();
report.button = { playing, cut, stopped, frozen: cut.paused && stopped.time === cut.time };
await page.screenshot({ path: `${root}/speak-emergency-stop.png` });
await page.getByRole("button", { name: "End call" }).click();
await page.getByTestId("owner-flow-halt").waitFor();
report.ownerHalt = (await page.getByTestId("owner-flow-halt").textContent())?.trim();
report.ownerCanClear = await page.getByTestId("owner-flow-stop").textContent();
await page.screenshot({ path: `${root}/speak-stop-owner-clear.png` });
await page.getByTestId("owner-flow-stop").click();
await page.getByTestId("owner-flow-halt").filter({ hasText: "Emergency stop is off" }).waitFor();
report.clearedByOwner = (await page.getByTestId("owner-flow-halt").textContent())?.trim();
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!report.tabClose.frozen || !report.button.frozen || report.button.cut.elapsedMs > 500 || report.stopped?.clearOnSpeak || report.button.stopped.clearOnSpeak) process.exit(1);
