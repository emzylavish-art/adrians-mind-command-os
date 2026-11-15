import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof/phone";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function stored() {
  return page.evaluate(() => ({
    theme: localStorage.getItem("amcos.theme.v1"),
    failover: localStorage.getItem("amcos.failover.v1"),
    voice: localStorage.getItem("amcos.voice.settings.v1"),
    pace: localStorage.getItem("adrian-speak-rate"),
  }));
}

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Open Settings" }).click();
await page.getByRole("button", { name: /Appearance/ }).click();
await page.getByRole("button", { name: "Light", exact: true }).click();
const failover = page.locator("#settings-general").getByRole("switch");
if ((await failover.getAttribute("aria-checked")) !== "true") await failover.click();
await page.getByRole("button", { name: "Back" }).click();
await page.getByRole("button", { name: /Voice/ }).click();
await page.getByRole("button", { name: "Fast", exact: true }).click();
const before = await stored();
await page.getByRole("button", { name: "Back" }).click();
await page.getByRole("button", { name: /Appearance/ }).click();
await page.getByTestId("settings-reset-appearance").click();
const afterAppearance = await stored();
await page.screenshot({ path: `${root}/set-09-appearance-reset.png` });
await page.getByRole("button", { name: "Back" }).click();
await page.getByRole("button", { name: /Voice/ }).click();
await page.getByTestId("settings-reset-voice").click();
const afterVoice = await stored();
await page.screenshot({ path: `${root}/set-09-voice-reset.png` });
console.log(JSON.stringify({ before, afterAppearance, afterVoice }, null, 2));
await browser.close();
const voiceBefore = JSON.parse(before.voice || "{}");
const voiceAfterAppearance = JSON.parse(afterAppearance.voice || "{}");
const voiceAfter = JSON.parse(afterVoice.voice || "{}");
if (before.theme !== "light" || before.failover !== "grok" || voiceBefore.speed !== "fast") process.exit(1);
if (afterAppearance.theme !== "dark" || afterAppearance.failover !== "none" || voiceAfterAppearance.speed !== "fast") process.exit(1);
if (afterVoice.theme !== "dark" || afterVoice.failover !== "none" || voiceAfter.speed !== "normal" || voiceAfter.personality !== "adrian" || voiceAfter.voiceId !== "eve" || afterVoice.pace !== "natural") process.exit(1);
