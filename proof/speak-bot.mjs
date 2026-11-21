import playwright from "/tmp/adrian-visual-handoff/node_modules/playwright/index.js";
const { chromium } = playwright;
import { mkdir, writeFile } from "node:fs/promises";

const out = "/home/ubuntu/adrians-mind-command-os/proof/speak-bot";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.setDefaultTimeout(25000);
let modelCalls = 0;
await page.route("**/api/mind/turn**", async (route) => {
  modelCalls += 1;
  await route.fulfill({ status: 200, contentType: "text/event-stream", body: "event: done\ndata: {\"ok\":true,\"text\":\"model should not answer\"}\n\n" });
});

async function overflow() {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

await page.goto("http://127.0.0.1:4195/", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Speak", exact: true }).first().click();
const speak = page.getByTestId("speak-stage");
await speak.getByLabel("Ask Anything").fill("create a bot named Harbor");
await speak.getByLabel("Ask Anything").press("Enter");
const reply = page.getByTestId("speak-reply");
await reply.filter({ hasText: "connected to Speak and Intelligence" }).waitFor();
const spoken = await reply.innerText();
if (!/Harbor is (created|already saved) and connected/.test(spoken)) throw new Error("Speak did not connect Harbor: " + spoken.slice(0, 240));
if (!spoken.includes("does not keep running after the tab closes")) throw new Error("Speak reply hid the always-on limit: " + spoken.slice(0, 240));
await page.getByRole("button", { name: "End call" }).click();

await page.locator("summary").filter({ hasText: "More" }).first().click();
await page.getByRole("button", { name: "EVE", exact: true }).click();
await page.getByLabel("Ask EVE").fill("create a bot named Lookout");
await page.getByTestId("eve-ask").click();
const eveReply = page.getByTestId("eve-reply");
await eveReply.filter({ hasText: "connected to Speak and Intelligence" }).waitFor({ timeout: 30000 });
const eve = await eveReply.innerText();
if (!/Lookout is (created|already saved) and connected/.test(eve)) throw new Error("Intelligence did not connect Lookout: " + eve.slice(0, 240));
if (modelCalls !== 0) throw new Error("A model was called " + modelCalls + " times");

await page.getByRole("button", { name: "Bots", exact: true }).click();
const harbor = page.getByRole("heading", { name: "Harbor", exact: true }).first();
const lookout = page.getByRole("heading", { name: "Lookout", exact: true }).first();
await harbor.waitFor();
await lookout.waitFor();
const card = harbor.locator("xpath=ancestor::li[1]");
await card.getByText("Manage Harbor").click();
const cardText = await card.innerText();
if (!cardText.includes("enabled schedule")) throw new Error("Harbor has no schedule: " + cardText);
if (!cardText.includes("local-worker")) throw new Error("Harbor has no local worker: " + cardText);

const desktopGap = await overflow();
if (desktopGap > 1) throw new Error("desktop overflow " + desktopGap);
await page.screenshot({ path: `${out}/desktop-dark.png`, fullPage: false });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
const phoneGap = await overflow();
if (phoneGap > 1) throw new Error("phone overflow " + phoneGap);
await lookout.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/phone-dark.png`, fullPage: false });

await writeFile(`${out}/record.json`, JSON.stringify({
  modelCalls,
  desktopGap,
  phoneGap,
  spoken: spoken.slice(0, 400),
  eve: eve.slice(0, 400),
  harbor: cardText.slice(0, 400),
}, null, 2));
await browser.close();
console.log("proof ok");
