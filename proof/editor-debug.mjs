import { chromium } from "playwright";

const root = "/home/ubuntu/adrians-mind-command-os/proof";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Open menu" }).click();
await page.getByRole("button", { name: "Build", exact: true }).first().click();
await page.getByRole("button", { name: "Editor", exact: true }).click();
const nav = page.getByRole("navigation", { name: "Build panels" });
await nav.getByRole("button", { name: "Files", exact: true }).click();
await page.getByRole("treeitem", { name: "debug-proof.mjs" }).click();
await page.getByRole("button", { name: "Debug", exact: true }).click();
await page.waitForFunction(() => {
  const text = document.querySelector(".code-ide-results")?.textContent || "";
  return /Paused at line|Nothing was paused|did not answer|debugger/i.test(text);
}, null, { timeout: 20000 });
const notice = (await page.locator(".code-ide-results").innerText()).trim();
await page.screenshot({ path: `${root}/editor-debug-phone.png` });
console.log(JSON.stringify({ notice: notice.slice(0, 240) }));
await browser.close();
