import playwright from "/tmp/adrian-visual-handoff/node_modules/playwright/index.js";
const { chromium } = playwright;
import { mkdir, writeFile } from "node:fs/promises";

const out = "/home/ubuntu/adrians-mind-command-os/proof/openrouter-connection";
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function overflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const card = document.querySelector("[data-testid='custom-ai-providers']");
    const list = document.querySelector("[aria-label='OpenRouter models']");
    const measure = (el) => el ? { scroll: el.scrollWidth, client: el.clientWidth, gap: el.scrollWidth - el.clientWidth } : null;
    return { root: measure(root), card: measure(card), list: measure(list) };
  });
}

async function openConnections(page) {
  await page.goto("http://127.0.0.1:4195/", { waitUntil: "domcontentloaded" });
  const settings = page.getByRole("button", { name: "Open Settings" });
  await settings.waitFor({ timeout: 20000 });
  await settings.click();
  await page.getByRole("button", { name: "Connections API keys and saved providers" }).click();
  await page.getByTestId("custom-ai-providers").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Remove" }).waitFor();
}

const record = { shots: [], checks: [] };
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);

await openConnections(page);
const text = await page.getByTestId("custom-ai-providers").innerText();
if (!text.includes("OpenRouter")) throw new Error("OpenRouter connection was not shown");
if (!text.includes("Remove")) throw new Error("Remove control was not shown");
if (!text.includes("441 models")) throw new Error("Full model count was not shown: " + text.slice(0, 240));
const first = await page.locator("[aria-label='OpenRouter models'] li").first().innerText();
if (!first.includes(":free")) throw new Error("First model was not free: " + first);

async function capture(name, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(300);
  const gaps = await overflow(page);
  const shot = `${out}/${name}.png`;
  await page.screenshot({ path: shot, fullPage: false });
  record.shots.push(shot);
  record.checks.push({ name, width, height, first, gaps });
  const over = [gaps.root, gaps.card, gaps.list].filter((item) => item && item.gap > 1);
  if (over.length) throw new Error(name + " overflow " + JSON.stringify(over));
}

await capture("desktop-dark", 1280, 800);
await capture("phone-dark", 390, 844);
await page.getByRole("button", { name: "Back" }).click();
await page.getByRole("button", { name: "Appearance Dark, light, or follow this device" }).click();
await page.getByRole("button", { name: "Light", exact: true }).click();
await page.getByRole("button", { name: "Back" }).click();
await page.getByRole("button", { name: "Connections API keys and saved providers" }).click();
await page.getByTestId("custom-ai-providers").waitFor();
await capture("desktop-light", 1280, 800);
await capture("phone-light", 390, 844);

await writeFile(`${out}/record.json`, JSON.stringify(record, null, 2));
await browser.close();
console.log("proof ok", record.checks.length);
