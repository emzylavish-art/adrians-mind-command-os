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
  await page.getByTestId("speak-clear-stop").waitFor();
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
    };
  });
}

await openSpeak();
const tabStarted = await playSpeech();
if (tabStarted.paused || tabStarted.time <= 0) throw new Error("Speech was not playing before the tab-close cut.");
await page.evaluate(() => {
  window.dispatchEvent(new Event("beforeunload"));
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
});
const tabCut = await speechState();
await page.waitForTimeout(500);
const tabLater = await speechState();
report.tabClose = { tabStarted, tabCut, frozen: tabCut.paused && tabLater.time === tabCut.time && tabCut.text.includes("The tab is closing.") };
await page.screenshot({ path: `${root}/speak-tab-close-cut.png` });

await openSpeak();
const playing = await playSpeech();
if (playing.paused || playing.time <= 0) throw new Error("Speech was not playing before the owner stop.");
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
report.ownerStop = { playing, cut, stopped, frozen: cut.paused && stopped.time === cut.time && stopped.text.includes("Emergency stop is on") };
await page.screenshot({ path: `${root}/speak-emergency-stop.png` });

await page.getByTestId("speak-clear-stop").click();
await page.getByTestId("speak-speech-cut").filter({ hasText: "EVE cleared the stop" }).waitFor();
report.eveClear = (await page.getByTestId("speak-speech-cut").textContent())?.trim();
await page.screenshot({ path: `${root}/speak-eve-clear.png` });
await page.getByRole("button", { name: "End call" }).click();
await page.getByTestId("owner-flow-halt").filter({ hasText: "Emergency stop is off" }).waitFor();
report.ownerAfterEveClear = (await page.getByTestId("owner-flow-halt").textContent())?.trim();

await page.getByTestId("owner-flow-speak").click();
await page.getByTestId("speak-emergency-stop").waitFor();
const again = await playSpeech();
if (again.paused || again.time <= 0) throw new Error("Speech did not restart after Eve cleared the stop.");
const second = await page.evaluate(() => {
  const audio = document.querySelector("[data-testid='proof-speech']");
  const startedAt = performance.now();
  document.querySelector("[data-testid='speak-emergency-stop']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return { elapsedMs: performance.now() - startedAt, paused: audio instanceof HTMLAudioElement ? audio.paused : null };
});
report.stillCuts = second;
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!report.tabClose.frozen || !report.ownerStop.frozen || report.ownerStop.cut.elapsedMs > 500 || !report.eveClear?.includes("EVE cleared") || !report.stillCuts.paused || report.stillCuts.elapsedMs > 500) process.exit(1);
