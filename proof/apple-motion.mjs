import playwright from "/tmp/adrian-visual-handoff/node_modules/playwright/index.js";
const { chromium } = playwright;
import { mkdir, writeFile } from "node:fs/promises";

const out = "/home/ubuntu/adrians-mind-command-os/proof/apple-motion";
await mkdir(out, { recursive: true });
const ease = "cubic-bezier(0.32, 0.72, 0, 1)";

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function motion(page) {
  return page.evaluate(() => {
    const button = document.querySelector("[aria-label='Open Settings']");
    const card = document.querySelector(".settings-card, .rounded-panel");
    const style = getComputedStyle(button);
    const cardStyle = card ? getComputedStyle(card) : null;
    const root = document.documentElement;
    return {
      flag: root.dataset.adrianMotion || "",
      hasSheet: Boolean(document.getElementById("adrian-apple-motion")),
      duration: style.transitionDuration,
      timing: style.transitionTimingFunction,
      property: style.transitionProperty,
      cardDuration: cardStyle?.transitionDuration || "",
      overflow: root.scrollWidth - root.clientWidth,
    };
  });
}

async function shot(page, name, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(250);
  const sample = await motion(page);
  const path = `${out}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  if (sample.flag !== "apple") throw new Error(name + " flag " + sample.flag);
  if (!sample.hasSheet) throw new Error(name + " missing sheet");
  if (!sample.timing.includes("0.32")) throw new Error(name + " timing " + sample.timing);
  if (sample.duration !== "0.28s") throw new Error(name + " duration " + sample.duration);
  if (/width|height|transform|top|left/.test(sample.property)) throw new Error(name + " property " + sample.property);
  if (sample.overflow > 1) throw new Error(name + " overflow " + sample.overflow);
  return { name, path, ...sample };
}

const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
await page.goto("http://127.0.0.1:4195/", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Open Settings" }).waitFor();
await page.waitForFunction(() => document.documentElement.dataset.adrianMotion === "apple");

const checks = [];
checks.push(await shot(page, "desktop-dark", 1280, 800));
checks.push(await shot(page, "phone-dark", 390, 844));

await page.setViewportSize({ width: 1280, height: 800 });
await page.getByRole("button", { name: "Open Settings" }).click();
await page.getByRole("button", { name: "Appearance Dark, light, or follow this device" }).click();
await page.getByRole("button", { name: "Light", exact: true }).click();
await page.getByRole("button", { name: "Back" }).click();
checks.push(await shot(page, "desktop-light", 1280, 800));
checks.push(await shot(page, "phone-light", 390, 844));

await context.close();
const reducedContext = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: "reduce",
});
const reduced = await reducedContext.newPage();
reduced.setDefaultTimeout(20000);
await reduced.goto("http://127.0.0.1:4195/", { waitUntil: "domcontentloaded" });
await reduced.getByRole("button", { name: "Open Settings" }).waitFor();
await reduced.waitForFunction(() => Boolean(document.getElementById("adrian-apple-motion")));
const quiet = await reduced.evaluate(() => {
  const button = document.querySelector("[aria-label='Open Settings']");
  const style = getComputedStyle(button);
  return {
    duration: style.transitionDuration,
    property: style.transitionProperty,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
if (quiet.duration !== "0s") throw new Error("reduced duration " + quiet.duration);
if (quiet.overflow > 1) throw new Error("reduced overflow " + quiet.overflow);
await reduced.screenshot({ path: `${out}/reduced-dark.png`, fullPage: false });
checks.push({ name: "reduced-dark", path: `${out}/reduced-dark.png`, ...quiet, ease });

await writeFile(`${out}/record.json`, JSON.stringify({ ease, checks }, null, 2));
await browser.close();
console.log("proof ok", checks.length);
