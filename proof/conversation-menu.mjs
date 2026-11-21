import playwright from "/tmp/adrian-visual-handoff/node_modules/playwright/index.js";
import { mkdir, writeFile } from "node:fs/promises";

const { chromium } = playwright;
const out = "/home/ubuntu/adrians-mind-command-os/proof/conversation-menu";
const probe = `Menu probe ${Date.now()}`;
const options = ["Add to project", "Copy task link", "Rename", "View all files", "Scheduled", "Pin", "Favorite", "Archive", "Quote in new task", "Delete"];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(20000);
await page.goto("http://127.0.0.1:4195/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByRole("button", { name: "Open Settings" }).waitFor();
await page.getByRole("button", { name: "First restore line" }).first().click();
await page.getByRole("button", { name: "New Chat" }).click();
const recent = page.getByTestId("sidebar-recent");
const created = recent.locator("[aria-current='true']");
await created.waitFor();
if (await page.getByRole("button", { name: "Download transcript (JSON)" }).count()) throw new Error("Transcript download is still beside the title");
if (await page.getByRole("button", { name: "Rename", exact: true }).count()) throw new Error("Rename is still beside the title");
await created.dispatchEvent("pointerdown");
await page.waitForTimeout(700);
await page.getByRole("dialog", { name: /Actions for / }).getByRole("button", { name: "Rename", exact: true }).click();
await page.getByRole("textbox", { name: "Conversation name" }).fill(probe);
await page.getByRole("button", { name: "Save name" }).click();
await page.getByRole("dialog").waitFor({ state: "hidden" });
const row = recent.getByRole("button", { name: probe, exact: true });
await row.waitFor();
if (await recent.getByRole("button", { name: `Actions for ${probe}` }).count()) throw new Error("An action button is still sitting beside the chat");
if (await recent.getByRole("button", { name: `Delete ${probe}` }).count()) throw new Error("Delete is still sitting outside the row");
await row.dispatchEvent("pointerdown");
await page.waitForTimeout(700);
const held = page.getByRole("dialog", { name: `Actions for ${probe}` });
await held.waitFor();
const parked = await held.evaluate((node) => Boolean(node.closest("aside, [data-testid='sidebar-recent']")));
if (parked) throw new Error("The action sheet is sitting inside the conversation column");
await page.mouse.up();
await page.screenshot({ path: `${out}/desktop-menu.png` });
for (const option of options) {
  if (!(await held.getByRole("button", { name: option, exact: true }).count())) throw new Error(`Missing ${option}`);
}
if (!(await held.getByRole("button", { name: "Download transcript", exact: true }).count())) throw new Error("Download transcript did not move into the sheet");
await page.mouse.click(8, 8);
await held.waitFor({ state: "hidden" });
await row.dispatchEvent("pointerdown");
await page.waitForTimeout(700);
await page.getByRole("dialog", { name: `Actions for ${probe}` }).getByRole("button", { name: "Delete", exact: true }).click();
await page.getByRole("button", { name: "Approve delete" }).click();
await recent.getByRole("button", { name: probe, exact: true }).waitFor({ state: "hidden" });
const besideNew = await page.getByRole("button", { name: "New Chat" }).evaluate((node) => {
  const column = node.closest("aside") || node.parentElement;
  return Boolean(column?.textContent?.includes("Delete"));
});
if (besideNew) throw new Error("Delete is still beside New Chat");
const desktopGap = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (desktopGap > 1) throw new Error(`desktop overflow ${desktopGap}`);
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Open menu" }).click();
await page.getByRole("button", { name: "Open Settings" }).click();
if (await page.getByRole("button", { name: "Delete Personalization section" }).count()) throw new Error("Settings delete is still outside");
await page.getByRole("button", { name: "Actions for Personalization section" }).click();
await page.getByRole("button", { name: "Delete section" }).click();
await page.getByRole("button", { name: "Restore Personalization" }).waitFor();
await page.getByRole("button", { name: "Restore Personalization" }).click();
const phoneGap = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (phoneGap > 1) throw new Error(`phone overflow ${phoneGap}`);
await page.screenshot({ path: `${out}/phone-sidebar.png` });
await writeFile(`${out}/record.json`, JSON.stringify({ probe, options, holdOpened: true, sheetOutsideColumn: true, desktopGap, phoneGap }, null, 2));
await browser.close();
console.log("proof ok", probe);
