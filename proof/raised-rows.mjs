import playwright from "/tmp/adrian-visual-handoff/node_modules/playwright/index.js";
const { chromium } = playwright;
import { mkdir, writeFile } from "node:fs/promises";

const out = "/home/ubuntu/adrians-mind-command-os/proof/raised-rows";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(20000);
await page.goto("http://127.0.0.1:4195/", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Open Settings" }).waitFor();
await page.setViewportSize({ width: 1280, height: 800 });
await page.getByRole("button", { name: "Open Settings" }).click();
await page.getByRole("button", { name: "Connections API keys and saved providers" }).click();
const list = page.getByRole("list", { name: "OpenRouter models" });
await list.waitFor();
const row = list.getByRole("button").first();
await row.waitFor();
const sample = await row.evaluate((node) => {
  const style = getComputedStyle(node);
  const text = node.innerText || "";
  return {
    shadow: style.boxShadow,
    background: style.backgroundColor,
    paper: /^\d+\.\s/.test(text),
    text: text.slice(0, 80),
    gap: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
if (sample.paper) throw new Error("Row still reads like paper: " + sample.text);
if (!sample.shadow || sample.shadow === "none") throw new Error("Row has no depth: " + sample.shadow);
if (sample.gap > 1) throw new Error("desktop overflow " + sample.gap);
await page.screenshot({ path: `${out}/desktop-dark.png`, fullPage: false });
await page.setViewportSize({ width: 390, height: 844 });
await row.scrollIntoViewIfNeeded();
await page.waitForTimeout(250);
const phoneGap = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (phoneGap > 1) throw new Error("phone overflow " + phoneGap);
await page.screenshot({ path: `${out}/phone-dark.png`, fullPage: false });
await writeFile(`${out}/record.json`, JSON.stringify({ sample, phoneGap }, null, 2));
await browser.close();
console.log("proof ok", sample.text);
