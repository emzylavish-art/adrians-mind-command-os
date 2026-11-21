import playwright from "/tmp/adrian-visual-handoff/node_modules/playwright/index.js";
import { mkdir, writeFile } from "node:fs/promises";

const { chromium } = playwright;
const out = "/home/ubuntu/adrians-mind-command-os/proof/conversation-delete";
const probe = `Delete probe ${Date.now()}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(20000);
await page.goto("http://127.0.0.1:4195/", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Open Settings" }).waitFor();
await page.getByRole("button", { name: "First restore line" }).first().click();
await page.getByRole("button", { name: "New Chat" }).click();
await page.getByRole("button", { name: "Rename" }).click();
await page.getByRole("textbox", { name: "Chat name" }).fill(probe);
await page.getByRole("button", { name: "Save" }).click();
const recent = page.getByTestId("sidebar-recent");
await recent.getByRole("button", { name: probe, exact: true }).waitFor();
const row = recent.getByRole("button", { name: probe, exact: true });
const depth = await row.evaluate((node) => getComputedStyle(node).boxShadow);
if (!depth || depth === "none") throw new Error("Sidebar row has no depth");
await recent.getByRole("button", { name: `Delete ${probe}`, exact: true }).click();
await page.getByRole("button", { name: "Approve delete" }).click();
await page.getByRole("button", { name: probe, exact: true }).waitFor({ state: "hidden" });
const section = recent.getByRole("button", { name: /Delete .+ section/ }).first();
const sectionName = await section.getAttribute("aria-label");
const before = await recent.innerText();
await section.click();
await page.getByRole("button", { name: "Deny" }).click();
if ((await recent.innerText()) !== before) throw new Error("Denying a section delete changed the sidebar");
const desktopGap = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (desktopGap > 1) throw new Error(`desktop overflow ${desktopGap}`);
await page.screenshot({ path: `${out}/desktop-sidebar.png` });
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Open menu" }).click();
await page.getByTestId("sidebar-recent").waitFor();
const phoneGap = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (phoneGap > 1) throw new Error(`phone overflow ${phoneGap}`);
await page.screenshot({ path: `${out}/phone-sidebar.png` });
await page.getByRole("button", { name: "Open Settings" }).click();
await page.getByRole("button", { name: "Delete Personalization section" }).click();
await page.getByRole("button", { name: "Restore Personalization" }).waitFor();
if (await page.getByRole("region", { name: "Personalization" }).count()) throw new Error("Personalization section was not removed");
await page.screenshot({ path: `${out}/phone-settings.png` });
await page.getByRole("button", { name: "Restore Personalization" }).click();
await page.getByRole("button", { name: "Delete Personalization section" }).waitFor();
await writeFile(`${out}/record.json`, JSON.stringify({ probe, sectionName, depth, phoneGap, desktopGap, deniedSection: true, settingsRestored: true }, null, 2));
await browser.close();
console.log("proof ok", probe);
